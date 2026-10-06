/**
 * A run that stops on purpose because something it needs is not there, such as
 * a `{{NOTE}}` step before any step wrote a note. Not a bug: the user sees the
 * choice's name and the reason as a plain notice, without the "Error running
 * ..." context or the logger's error prefix. The message is one sentence that
 * reads on its own, because the CLI and URI outcomes carry it as their reason.
 */
export class RefusalError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "RefusalError";
	}
}

/** The notice for a refusal: the choice's name, then the reason. */
export function refusalNotice(choiceName: string, error: RefusalError): string {
	const reason = error.message;
	return `${choiceName}: ${reason.charAt(0).toLowerCase()}${reason.slice(1)}`;
}
