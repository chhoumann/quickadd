import { findInlineScriptSpans } from "./inlineScriptSpans";
import type { TemplateFolderConfig } from "../types/choices/ITemplateChoice";

/**
 * The folder a preview resolves `{{FOLDER}}` against, or `undefined` when it
 * cannot honestly name one. Only a single, literal configured folder qualifies:
 * several destinations open a chooser at run time, and a tokenized folder or
 * inline script would be spliced raw into the preview (or executed). `undefined`
 * falls back to the caller's neutral placeholder.
 */
export function likelyTargetFolderPath(
	folder: TemplateFolderConfig | undefined,
): string | undefined {
	if (!folder?.enabled) return undefined;
	if (
		folder.chooseWhenCreatingNote ||
		folder.chooseFromSubfolders ||
		folder.createInSameFolderAsActiveFile
	) {
		return undefined;
	}
	const folders = folder.folders ?? [];
	if (folders.length !== 1) return undefined;

	const only = folders[0]?.trim();
	if (!only) return undefined;
	if (only.includes("{{")) return undefined;
	if (findInlineScriptSpans(only).length > 0) return undefined;
	return only;
}
