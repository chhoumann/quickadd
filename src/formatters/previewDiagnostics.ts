import { isCancellationError } from "../utils/errorUtils";

export type PreviewDiagnosticSeverity = "warning" | "error";

/**
 * `"path"` marks a problem with the resulting PATH rather than with resolving
 * the format: the name came out fine, the vault will just not accept it (a "."
 * or ".." segment, #1563; a character Obsidian refuses, #1578).
 *
 * The distinction exists because a host can know the field is not a path at all
 * - the capture target may hold picker syntax like `property:type=draft`, which
 * the run parses before ever treating it as a file - and must then be able to
 * discard exactly these while keeping every other diagnostic. See #1594 for the
 * "Unresolved:" label, which wants the same split.
 */
export type PreviewDiagnosticKind = "path";

export type PreviewDiagnostic = {
	severity: PreviewDiagnosticSeverity;
	message: string;
	kind?: PreviewDiagnosticKind;
};

/**
 * The problems one preview pass ran into, for passive display beside the
 * preview instead of a Notice per keystroke (issue #1558).
 *
 * Ordered and deduplicated: a format string can mention the same malformed
 * token twice, and the parsers themselves re-walk a token in more than one pass,
 * so the same sentence would otherwise appear two or three times under one
 * field. Distinct problems all survive - the key is the whole message, and every
 * message interpolates the token it is about.
 */
export class PreviewDiagnostics {
	private readonly entries: PreviewDiagnostic[] = [];
	private readonly seen = new Set<string>();

	add(
		severity: PreviewDiagnosticSeverity,
		message: string,
		kind?: PreviewDiagnosticKind,
	): void {
		const cleaned = stripBrandPrefix(message).trim();
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
 * These messages were written for a Notice, where `GuiLogger` prepends
 * "QuickAdd: (Warning) " (quickAddLogger.ts) - so most of them also open with a
 * literal "QuickAdd: " that reads as a stutter there and as pure noise inline
 * under a QuickAdd settings field.
 *
 * The template cycle/depth reports arrive wrapped as `[QuickAdd: ... ]` because
 * the same string is ALSO spliced into the output as a placeholder. Unwrap those
 * first, or the preview shows the identical bracketed sentence twice, twenty
 * pixels apart.
 */
function stripBrandPrefix(message: string): string {
	const unwrapped = message.replace(/^\[(QuickAdd:[\s\S]*)\]$/i, "$1");
	return unwrapped.replace(/^QuickAdd:\s*/i, "");
}

/**
 * Turns a thrown formatting failure into an inline diagnostic, or `null` when it
 * should not be shown.
 *
 * The display formatters wrap the whole pipeline in `catch { return input; }`,
 * so a token that THROWS (`{{VALUE:a,b|text:x}}`, a half-typed `{{VALUE:}}`)
 * silently echoes the raw text back — the exact state a confused author is
 * already in. These are the most useful diagnostics the preview can produce, so
 * they go in the same channel as the warnings.
 *
 * The catch is untyped and catches everything, so a non-Error throw degrades to
 * a generic line. An `Error` message IS shown verbatim: there is deliberately no
 * brand allowlist, because most of the reachable throws are QuickAdd-authored but
 * unbranded, and on the rare occasion a genuine plugin bug surfaces here, its
 * message is what makes the bug report actionable.
 */
export function describePreviewFailure(error: unknown): string | null {
	// A cancelled prompt is a user action, not an authoring mistake. The preview
	// formatters never prompt, but a nested resolver still can. Check the RAW
	// value first, before the `instanceof Error` gate below: a dismissal is a
	// typed UserCancelError (#1577), and letting it reach that gate would report
	// every cancellation as "Preview unavailable".
	if (isCancellationError(error)) return null;
	if (!(error instanceof Error)) return PREVIEW_FAILED_MESSAGE;
	const message = error.message ?? "";
	// Covers a USER SCRIPT that throws an Error whose message is one of the legacy
	// sentinels (see `isCancellationError`) - the shape a script written against the
	// pre-#1577 strings still uses. It deliberately does NOT cover
	// `toError(err, context)`, which prefixes the context and so matches no sentinel;
	// adding the canonical message to that set would not fix it either, and nothing
	// wraps on the way into this function.
	if (isCancellationError(message)) return null;
	// By far the most frequent throw: the token autocomplete inserts `{{VALUE:}}`
	// with the caret between the colon and the braces, and VARIABLE_REGEX matches
	// the empty name. The raw message quotes a slice of the surrounding text and
	// says nothing useful, so this one gets real copy.
	if (message.startsWith("Unable to parse variable")) {
		return "This token is incomplete. {{VALUE:}} needs a name, for example {{VALUE:title}}.";
	}
	return message.trim() ? message : PREVIEW_FAILED_MESSAGE;
}

const PREVIEW_FAILED_MESSAGE = "Preview unavailable - this format could not be resolved.";
