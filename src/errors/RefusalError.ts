import { MacroAbortError } from "./MacroAbortError";

/**
 * A run that stops on purpose because something it needs is not set up, such as
 * the Daily notes core plugin for `{{DAILY}}` or a template file that is not
 * there. Not a bug: the user sees one plain sentence naming the choice, what is
 * missing, what did not happen and the one thing to do, without the "Error
 * running ..." context or the logger's error prefix. The CLI and URI outcomes
 * carry the same sentence as their reason.
 *
 * An abort, so it stops an enclosing sequence the way any abort does. The
 * innermost choice that stops names itself in the sentence (see {@link claimRefusal}).
 */
export class RefusalError extends MacroAbortError {
	/** The choice the sentence names, once a run has claimed the refusal. */
	choiceName: string | null = null;
}

/**
 * Builds a refusal: `<what is missing>, so <what did not happen>. <What to do.>`
 * The choice's name is added when a run reports it.
 */
export function refuse(missing: string, consequence: string, action?: string): RefusalError {
	return new RefusalError(`${missing}, so ${consequence}.${action ? ` ${action}` : ""}`);
}

/**
 * Names the choice that refused in the sentence and returns it. The first claim
 * wins, so a refusal inside a sequence names the step's choice, not the sequence.
 */
export function claimRefusal(error: RefusalError, choiceName: string): string {
	if (error.choiceName === null) {
		error.choiceName = choiceName;
		error.message = `${choiceName}: ${error.message.charAt(0).toLowerCase()}${error.message.slice(1)}`;
	}
	return error.message;
}
