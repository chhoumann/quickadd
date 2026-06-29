import { hasTemplatePathSyntax } from "../../utils/templatePathSyntax";
import { parsePropertyTarget } from "../../utils/propertyTarget";
import { parseCaptureFileFilterTarget } from "../../utils/captureFileFilterTarget";
import type { FieldFilter } from "../../utils/FieldSuggestionParser";

/**
 * The runtime "pick a destination" scope a Capture choice's "Capture to" string
 * resolves to when it does NOT point at one definite file. These are exactly the
 * cases that legitimately need a runtime file selection (the preflight modal, or
 * a non-interactive CLI `value-__qa.captureTargetFilePath`). A definite-file or
 * tokenized-file target, or capture-to-active-file, has NO such scope and yields
 * `null`.
 */
export type CaptureTargetScope =
	| { kind: "folder"; folderPathSlash: string }
	| { kind: "filter"; filter: FieldFilter }
	| { kind: "property"; field: string; value?: string; filter: FieldFilter }
	| { kind: "tag"; tag: string };

export interface CaptureTargetScopeDeps {
	/** Whether the given vault-relative path is an existing folder. */
	isFolder(path: string): boolean;
}

/**
 * Classifies a RAW (unformatted) "Capture to" string into the runtime-picker
 * scope it represents, or `null` when the target is a definite/tokenized file (no
 * runtime pick needed) or the choice captures to the active file.
 *
 * This is the SINGLE source of truth shared by:
 *  - the preflight requirement collector, which emits the
 *    `QA_INTERNAL_CAPTURE_TARGET_FILE_PATH` requirement (and prompts for the pick)
 *    precisely for these scopes; and
 *  - {@link CaptureChoiceEngine}, which only honours a preselected capture-target
 *    variable for these same scopes, and confines it to the scope.
 *
 * Keeping ONE classifier means the engine can never disagree with the collector
 * about whether a preselected value is legitimate — so a value injected across a
 * trust boundary (an `obsidian://` URI, the CLI, or a `{{VALUE:__qa.…}}` token in
 * a synced/imported choice) cannot redirect a definite-file capture, and a
 * legitimately collected pick is never silently dropped.
 */
export function classifyCaptureTargetScope(
	deps: CaptureTargetScopeDeps,
	rawCaptureTo: string,
	captureToActiveFile: boolean,
): CaptureTargetScope | null {
	if (captureToActiveFile) return null;

	const normalizedTarget = (rawCaptureTo ?? "").trim().replace(/^\/+/, "");

	// A target carrying a format token (e.g. `Projects/{{VALUE}}.md`,
	// `Notes/{{DATE}}/`, `#{{VALUE}}`) is only resolvable at run time, so in EVERY
	// shape - file, folder, tag, property - it is never a stable picker scope: it
	// gets no preflight requirement and the engine never honours a preselected pick
	// for it. Returning early keeps that uniform across all branches below.
	if (hasTemplatePathSyntax(normalizedTarget)) return null;

	const propertyTarget = parsePropertyTarget(normalizedTarget);
	const isPropertyTarget = !!propertyTarget && !!propertyTarget.field;

	const fileFilterTarget = !isPropertyTarget
		? parseCaptureFileFilterTarget(normalizedTarget)
		: null;
	// A multi-select filter is not a single-destination capture scope.
	const isFilterTarget = !!fileFilterTarget && !fileFilterTarget.multiSelect;

	const isTagTarget =
		!isPropertyTarget &&
		!fileFilterTarget &&
		normalizedTarget.startsWith("#");

	const trimmedPath = normalizedTarget.replace(/\/$|\.md$/g, "");
	const isFolderTarget =
		!isTagTarget &&
		!isPropertyTarget &&
		!isFilterTarget &&
		(normalizedTarget === "" || deps.isFolder(trimmedPath));
	const looksLikeFolderBySuffix =
		!isPropertyTarget && !isFilterTarget && normalizedTarget.endsWith("/");

	if (isPropertyTarget && propertyTarget) {
		return {
			kind: "property",
			field: propertyTarget.field,
			value: propertyTarget.value,
			filter: propertyTarget.filter,
		};
	}
	if (isFilterTarget && fileFilterTarget) {
		return { kind: "filter", filter: fileFilterTarget.filter };
	}
	if (isTagTarget) {
		return { kind: "tag", tag: normalizedTarget };
	}
	if (isFolderTarget || looksLikeFolderBySuffix) {
		const folder = normalizedTarget.replace(/(?:\/|\.md)+$/g, "");
		const folderPathSlash =
			folder === "" ? "" : folder.endsWith("/") ? folder : `${folder}/`;
		return { kind: "folder", folderPathSlash };
	}

	return null;
}
