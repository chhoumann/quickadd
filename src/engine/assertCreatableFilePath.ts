import { ChoiceAbortError } from "../errors/ChoiceAbortError";
import {
	describeIllegalFilePathCharsForRun,
	findIllegalFilePathChars,
} from "../utils/generatedFilePath";

/**
 * Stops a choice as soon as its target path is known when Obsidian will refuse
 * to create it, before the folder is created and the template or capture is
 * formatted (running prompts, macros and inline scripts).
 *
 * Call only where the file is about to be created: `:` is legal on macOS and
 * Linux, so appending to an existing note with one works. Not inside
 * `normalizeGeneratedFilePath`, which CaptureChoiceEngine calls as an existence
 * probe inside try/catch. The rule and wording come from `generatedFilePath.ts`,
 * shared with the preview.
 */
export function assertCreatableFilePath(path: string): void {
	const illegal = findIllegalFilePathChars(path);
	if (illegal.length === 0) return;
	throw new ChoiceAbortError(
		describeIllegalFilePathCharsForRun(illegal, path),
	);
}

/**
 * {@link assertCreatableFilePath} as a predicate, for a caller that should
 * quietly decline rather than abort - the "move this note?" offer, which is an
 * optional convenience and must not ask a question that cannot succeed.
 */
export function isCreatableFilePath(path: string): boolean {
	return findIllegalFilePathChars(path).length === 0;
}
