import {
	BASE_FILE_EXTENSION_REGEX,
	CANVAS_FILE_EXTENSION_REGEX,
	MARKDOWN_FILE_EXTENSION_REGEX,
} from "../../constants";
import { hasTemplatePathSyntax } from "../../utils/templatePathSyntax";
import { parsePropertyTarget } from "../../utils/propertyTarget";
import { parseCaptureFileFilterTarget } from "../../utils/captureFileFilterTarget";
import type { FieldFilter } from "../../utils/FieldSuggestionParser";

/**
 * The vault path of the Markdown note a bare folder-candidate path would collide
 * with, i.e. {@link QuickAddEngine.normalizeMarkdownFilePath}`("", candidate)`.
 * Callers bind {@link CaptureTargetScopeDeps.markdownFileExists} by probing the
 * vault for exactly this path, so the classifier's folder-vs-file disambiguation
 * matches resolveCaptureTarget's (which uses the same normalize) byte-for-byte.
 */
export function markdownFilePathForFolderCandidate(candidate: string): string {
	return `${candidate.replace(/^\/+/, "").replace(MARKDOWN_FILE_EXTENSION_REGEX, "")}.md`;
}

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
	/**
	 * Whether a same-named Markdown NOTE exists for a bare folder-candidate path,
	 * i.e. whether {@link markdownFilePathForFolderCandidate}`(path)` resolves to an
	 * existing file (a `TFile`, NOT a folder that merely shares the `X.md` name).
	 * Mirrors the disambiguation resolveCaptureTarget performs (a bare name targets
	 * a folder only when the folder exists AND no same-name note does), so the
	 * classifier never offers a folder pick for a bare name the write path would
	 * resolve to a definite file.
	 */
	markdownFileExists(path: string): boolean;
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

	const endsWithSlash = normalizedTarget.endsWith("/");

	// A target carrying a recognized file extension with no trailing slash is never
	// a runtime-pick scope. This mirrors resolveCaptureTarget, which tests the
	// extension BEFORE the folder-ambiguity check, so an extensioned target that
	// happens to collide with a same-named folder is NOT misrouted to that folder
	// in either classifier. `.md`/`.canvas` are definite files; `.base` is
	// unsupported (the resolver throws on it downstream) - in all three cases the
	// engine must NOT honour an injected `__qa.captureTargetFilePath`, so returning
	// `null` here both stops the spurious folder prompt AND preserves the #1448
	// reserved-key confinement for a configured definite/unsupported file target.
	const hasRecognizedFileExtension =
		!isTagTarget &&
		!isPropertyTarget &&
		!isFilterTarget &&
		!endsWithSlash &&
		(MARKDOWN_FILE_EXTENSION_REGEX.test(normalizedTarget) ||
			CANVAS_FILE_EXTENSION_REGEX.test(normalizedTarget) ||
			BASE_FILE_EXTENSION_REGEX.test(normalizedTarget));

	const folderProbePath = normalizedTarget.replace(/\/+$/, "");
	// A bare name targets a folder only when the folder exists AND no same-name
	// note does (resolveCaptureTarget's disambiguation; docs: "if both Projects/
	// and Projects.md exist, Projects targets Projects.md"). Probing for the note
	// keeps the classifier from offering a folder pick - and honouring an injected
	// pick - for a bare name the write path resolves to a definite file. An empty
	// target is the whole-vault scope and needs no probe. A trailing-slash target
	// forces the folder regardless (handled by looksLikeFolderBySuffix below).
	const isFolderTarget =
		!isTagTarget &&
		!isPropertyTarget &&
		!isFilterTarget &&
		!hasRecognizedFileExtension &&
		(normalizedTarget === "" ||
			(deps.isFolder(folderProbePath) &&
				!deps.markdownFileExists(folderProbePath)));
	const looksLikeFolderBySuffix =
		!isPropertyTarget && !isFilterTarget && endsWithSlash;

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
		// Strip only trailing slashes (NOT `.md`): a `.md` target is already
		// short-circuited to a definite file above, so a folder named `X.md`
		// reached via a trailing slash (`X.md/`) must keep its name - matching
		// resolveCaptureTarget's folder branch (`replace(/\/+$/, "")`).
		const folder = folderProbePath;
		const folderPathSlash = folder === "" ? "" : `${folder}/`;
		return { kind: "folder", folderPathSlash };
	}

	return null;
}
