import { ChoiceAbortError } from "../errors/ChoiceAbortError";
import {
	describeIllegalFilePathCharsForRun,
	findIllegalFilePathChars,
} from "../utils/generatedFilePath";

/**
 * Stops a choice at the moment its target path is known, when Obsidian will
 * refuse to create it anyway (#1591).
 *
 * Without this the refusal arrives from `vault.create`, by which point QuickAdd
 * has already created the target FOLDER and formatted the entire template body
 * or capture - real `{{VALUE}}` prompts, macros, and inline `js quickadd`
 * fences with whatever side effects those scripts have. Measured on Obsidian
 * 1.13.0: a Template choice named `Bad: {{VALUE:title}}` left an empty folder
 * behind and ran the template's inline script once before dying.
 *
 * CALL ONLY WHERE THE FILE IS ABOUT TO BE CREATED. `:` is legal on macOS and
 * Linux at the filesystem level, so a note made outside Obsidian really can
 * carry one - and appending to it works today, because nothing ever asks
 * Obsidian to accept the name. Every call site below sits on a branch where the
 * target's non-existence has already been established, which is why this takes
 * no vault and does no probing of its own.
 *
 * Deliberately NOT inside `normalizeGeneratedFilePath`: `CaptureChoiceEngine`
 * calls that as an existence PROBE inside `try/catch`, where a new throw would
 * silently answer "does not exist".
 *
 * The rule and its wording come from `generatedFilePath.ts`, which the preview
 * also reads, so the row that warns and the code that stops cannot drift.
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
