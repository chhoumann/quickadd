import type { TAbstractFile } from "obsidian";
import {
	BASE_FILE_EXTENSION_REGEX,
	CANVAS_FILE_EXTENSION_REGEX,
	MARKDOWN_FILE_EXTENSION_REGEX,
} from "../../constants";
import { ChoiceAbortError } from "../../errors/ChoiceAbortError";
import type { FieldFilter } from "../../utils/FieldSuggestionParser";
import { parsePropertyTarget } from "../../utils/propertyTarget";
import { parseCaptureFileFilterTarget } from "../../utils/captureFileFilterTarget";
import { normalizeGeneratedFilePath } from "../../utils/generatedFilePath";

/**
 * The concrete capture destination decision derived from a (formatted) "Capture
 * to" string. Discriminated so each downstream branch (vault-wide picker,
 * filtered picker, frontmatter-property picker, folder picker, or a definite
 * file path) is selected without re-parsing the string.
 */
export type CaptureTargetResolution =
	| { kind: "vault" }
	| { kind: "filter"; filter: FieldFilter }
	| { kind: "property"; field: string; value?: string; filter: FieldFilter }
	| { kind: "folder"; folder: string }
	| { kind: "file"; path: string };

/**
 * Vault probes the resolver needs, injected so the classification stays a pure
 * function of (input, deps) — deterministic and unit-testable with stubs, with
 * no direct Obsidian `App` dependency. The engine binds these to the live vault.
 */
export interface CaptureTargetDeps {
	getAbstractFileByPath(path: string): TAbstractFile | null;
	isFolder(path: string): boolean;
	/** Mirrors QuickAddEngine.normalizeMarkdownFilePath (the single source of truth). */
	normalizeMarkdownFilePath(folderPath: string, fileName: string): string;
}

/**
 * Classifies a formatted "Capture to" string into a concrete destination.
 *
 * Resolution order:
 * 1) empty => vault picker
 * 2) #tag/tag:/folder: filters => filtered picker
 * 3) property:<field>[=<value>] => frontmatter-property picker
 * 4) trailing "/" => folder picker (explicit)
 * 5) known file extension => file
 * 6) ambiguous => folder if it exists and no same-name file exists; else file
 */
export function resolveCaptureTarget(
	formattedCaptureTo: string,
	deps: CaptureTargetDeps,
): CaptureTargetResolution {
	const rawCaptureTo = formattedCaptureTo.trim().replace(/^\/+/, "");

	if (rawCaptureTo === "") {
		return { kind: "vault" };
	}

	// `property:<field>[=<value>]` pre-filters by a frontmatter field (issue #466).
	// Checked before the `.base`/extension/folder branches so a property value
	// containing `.md`/`/` (or a trailing `/`) can never misroute to a file/folder.
	const propertyTarget = parsePropertyTarget(rawCaptureTo);
	if (propertyTarget) {
		if (!propertyTarget.field) {
			throw new ChoiceAbortError(
				"Property capture target needs a field name, e.g. property:type=draft",
			);
		}
		return {
			kind: "property",
			field: propertyTarget.field,
			value: propertyTarget.value,
			filter: propertyTarget.filter,
		};
	}

	const fileFilterTarget = parseCaptureFileFilterTarget(rawCaptureTo);
	if (fileFilterTarget) {
		if (fileFilterTarget.multiSelect) {
			throw new ChoiceAbortError(
				"Capture target filters select one destination file. Use {{FILE:...|multi}} in the capture format for multi-value metadata.",
			);
		}
		return {
			kind: "filter",
			filter: fileFilterTarget.filter,
		};
	}

	const normalizedCaptureTo = normalizeGeneratedFilePath(
		rawCaptureTo,
		"Capture target file path",
	);

	if (BASE_FILE_EXTENSION_REGEX.test(normalizedCaptureTo)) {
		throw new ChoiceAbortError(
			`Capture to '.base' files is not supported (${normalizedCaptureTo}). Use a Template choice instead.`,
		);
	}

	const endsWithSlash = normalizedCaptureTo.endsWith("/");
	const folderPath = normalizedCaptureTo.replace(/\/+$/, "");

	if (endsWithSlash) {
		return { kind: "folder", folder: folderPath };
	}

	if (
		MARKDOWN_FILE_EXTENSION_REGEX.test(normalizedCaptureTo) ||
		CANVAS_FILE_EXTENSION_REGEX.test(normalizedCaptureTo)
	) {
		return { kind: "file", path: normalizedCaptureTo };
	}

	// Guard against ambiguity where a folder and file share the same name.
	const fileCandidatePath = deps.normalizeMarkdownFilePath("", folderPath);
	const fileCandidate = deps.getAbstractFileByPath(fileCandidatePath);
	const fileExists = !!fileCandidate;

	if (deps.isFolder(folderPath) && !fileExists) {
		return { kind: "folder", folder: folderPath };
	}

	return { kind: "file", path: normalizedCaptureTo };
}
