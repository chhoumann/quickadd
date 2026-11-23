import { withoutBrandPrefix } from "../logger/quickAddLogger";
import { isCancellationError } from "../utils/errorUtils";

type PreviewDiagnosticSeverity = "warning" | "error";

/**
 * `"path"` marks a resulting path the vault will not accept, rather than a
 * failure to resolve the format. A host that knows the field is not a path
 * (capture-target picker syntax) can drop exactly these.
 */
type PreviewDiagnosticKind = "path";

export type PreviewDiagnostic = {
	severity: PreviewDiagnosticSeverity;
	message: string;
	kind?: PreviewDiagnosticKind;
};

/**
 * Problems from one preview pass, shown beside the preview instead of a Notice
 * per keystroke. Deduplicated by message, since the parsers re-walk a token in
 * more than one pass.
 */
export class PreviewDiagnostics {
	private readonly entries: PreviewDiagnostic[] = [];
	private readonly seen = new Set<string>();

	add(
		severity: PreviewDiagnosticSeverity,
		message: string,
		kind?: PreviewDiagnosticKind,
	): void {
		const cleaned = withoutBrandPrefix(message).trim();
		if (!cleaned) return;
		const key = `${severity} ${cleaned}`;
		if (this.seen.has(key)) return;
		this.seen.add(key);
		this.entries.push({ severity, message: cleaned, ...(kind ? { kind } : {}) });
	}

	list(): readonly PreviewDiagnostic[] {
		return this.entries;
	}

	get hasError(): boolean {
		return this.entries.some((entry) => entry.severity === "error");
	}
}

/**
 * Turns a thrown formatting failure into an inline diagnostic, or `null`. The
 * display formatters catch everything and echo their input, so this is where a
 * throw becomes visible. Error messages are shown verbatim so a genuine bug's
 * message stays actionable.
 */
export function describePreviewFailure(error: unknown): string | null {
	// Check the raw value before the `instanceof Error` gate, or every
	// cancellation would read "Preview unavailable".
	if (isCancellationError(error)) return null;
	if (!(error instanceof Error)) return PREVIEW_FAILED_MESSAGE;
	const message = error.message ?? "";
	// A user script that throws one of the legacy cancellation sentinel messages.
	if (isCancellationError(message)) return null;
	// The autocomplete inserts `{{VALUE:}}` with the caret inside, so this is the
	// most frequent throw, and its raw message is unhelpful.
	if (message.startsWith("Unable to parse variable")) {
		return "This token is incomplete. {{VALUE:}} needs a name, for example {{VALUE:title}}.";
	}
	return message.trim() ? message : PREVIEW_FAILED_MESSAGE;
}

const PREVIEW_FAILED_MESSAGE = "Preview unavailable - this format could not be resolved.";
