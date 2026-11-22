import {
	BASE_FILE_EXTENSION_REGEX,
	CANVAS_FILE_EXTENSION_REGEX,
	MARKDOWN_FILE_EXTENSION_REGEX,
} from "../../constants";
import { hasTemplatePathSyntax } from "../../utils/templatePathSyntax";
import { parsePropertyTarget } from "../../utils/propertyTarget";
import { parseCaptureFileFilterTarget } from "../../utils/captureFileFilterTarget";
import type { FieldFilter } from "../../utils/FieldSuggestionParser";
import { normalizeMarkdownFilePath } from "../vaultFiles";

/**
 * The note a bare folder-candidate path collides with, normalized exactly as
 * resolveCaptureTarget does.
 */
export function markdownFilePathForFolderCandidate(candidate: string): string {
	return normalizeMarkdownFilePath("", candidate);
}

/**
 * Where a "Capture to" string that names no single definite file asks the user
 * to pick at run time. Definite or tokenized files and capture-to-active have none.
 */
export type CaptureTargetScope =
	| { kind: "folder"; folderPathSlash: string }
	| { kind: "filter"; filter: FieldFilter }
	| { kind: "property"; field: string; value?: string; filter: FieldFilter }
	| { kind: "tag"; tag: string };

interface CaptureTargetScopeDeps {
	isFolder(path: string): boolean;
	/**
	 * Whether {@link markdownFilePathForFolderCandidate}`(path)` is an existing
	 * file. A bare name targets a folder only when no same-name note exists.
	 */
	markdownFileExists(path: string): boolean;
}

/**
 * Classifies a raw "Capture to" string into its runtime-picker scope, or `null`.
 * The preflight collector and CaptureChoiceEngine share this one classifier, so a
 * preselected target injected across a trust boundary (URI, CLI, `{{VALUE:__qa.…}}`)
 * cannot redirect a definite-file capture.
 */
export function classifyCaptureTargetScope(
	deps: CaptureTargetScopeDeps,
	rawCaptureTo: string,
	captureToActiveFile: boolean,
): CaptureTargetScope | null {
	if (captureToActiveFile) return null;

	const normalizedTarget = (rawCaptureTo ?? "").trim().replace(/^\/+/, "");

	// A tokenized target only resolves at run time, so it is never a picker scope.
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

	// Mirrors resolveCaptureTarget, which checks the extension before folder
	// ambiguity: an extensioned target is a definite (or unsupported) file and
	// must not honour an injected capture-target pick.
	const hasRecognizedFileExtension =
		!isTagTarget &&
		!isPropertyTarget &&
		!isFilterTarget &&
		!endsWithSlash &&
		(MARKDOWN_FILE_EXTENSION_REGEX.test(normalizedTarget) ||
			CANVAS_FILE_EXTENSION_REGEX.test(normalizedTarget) ||
			BASE_FILE_EXTENSION_REGEX.test(normalizedTarget));

	const folderProbePath = normalizedTarget.replace(/\/+$/, "");
	// A bare name targets a folder only when the folder exists and no same-name
	// note does, matching resolveCaptureTarget.
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
		// Strip only trailing slashes so a folder named `X.md/` keeps its name.
		const folder = folderProbePath;
		const folderPathSlash = folder === "" ? "" : `${folder}/`;
		return { kind: "folder", folderPathSlash };
	}

	return null;
}
