import { INLINE_JAVASCRIPT_REGEX } from "../constants";
import type { TemplateFolderConfig } from "../types/choices/ITemplateChoice";

/**
 * The folder a PREVIEW should resolve `{{FOLDER}}` against, or `undefined` when
 * it cannot honestly name one.
 *
 * `{{FOLDER}}` is substituted verbatim from `Formatter.targetFolderPath`, so
 * whatever is passed here lands in the previewed name unchanged. Two things
 * therefore have to be true before a configured folder can be used:
 *
 * 1. **The run must have already decided it.** `TemplateChoiceEngine` opens a
 *    folder suggester whenever more than one destination is in play - several
 *    configured folders, "ask each time", subfolders, or "same folder as the
 *    current file". Only a single plain folder is knowable up front.
 * 2. **It must be a literal.** The run formats the configured folder first
 *    (`getFolderPath` -> `CompleteFormatter.formatFolderPath`), while
 *    `setTargetFolderPath` only trims slashes - so handing over a raw
 *    `Journal/{{DATE:YYYY-MM}}` would splice the literal token into the name
 *    AND, because every argument-bearing token carries a colon in its own
 *    syntax, raise the illegal-character error (#1578) against a choice that
 *    works. The same goes for an inline `js quickadd` fence, which
 *    `formatFolderPath` really does EXECUTE (it is `format()`'s first pass) and
 *    which the folder validator permits, because backticks are not among the
 *    characters it rejects - and which the preview must never run (#1558).
 *    Resolving the folder through a second nested formatter pass is not worth
 *    that: `undefined` falls back to the caller's neutral placeholder, which is
 *    what the builder has always shown here.
 *
 * KNOWN RESIDUAL, not fixed here: even for a single configured folder the run
 * can still prompt, because `TemplateChoiceEngine` adds a `<current folder>`
 * row to the suggester, so answering it can produce a different folder than the
 * one previewed. That is a run-side defect with its own issue; the previewed
 * folder is nonetheless strictly closer to the truth than the placeholder it
 * replaces.
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
	if (INLINE_JAVASCRIPT_REGEX.test(only)) return undefined;
	return only;
}
