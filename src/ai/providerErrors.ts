// Provider-agnostic normalization and classification of AI provider/HTTP errors.
//
// Obsidian's `requestUrl` rejects a failed request with a bare
// `"Request failed, status N"` error that carries no response body, so the
// request layer captures the body itself (see `buildProviderError`) and the
// classification below reasons over the resulting structured error.

// Signals that the *input* (prompt/messages) exceeded the model's context window
// — the only failure that retrying with smaller chunks can fix.
const INPUT_CONTEXT_LIMIT_PATTERNS = [
	/context[_ -]?length[_ -]?exceeded/i,
	/context[_ -]?window[_ -]?exceeded/i,
	/maximum context length/i,
	/context window/i,
	/too many input tokens/i,
	/input(?: is)? too long/i,
	/prompt(?: is)? too long/i,
	/input token count/i, // Gemini: "The input token count (N) exceeds the maximum number of tokens allowed (M)."
	/reduce the length of (?:the |your )?(?:messages|prompt|input)/i,
	// OpenAI-compatible / local servers: "exceeded the maximum (input) token/context …".
	// Output-budget errors are matched earlier, so this stays input-specific.
	/exceed(?:s|ed|ing)? (?:the )?(?:maximum |allowed )?(?:input |prompt )?(?:token|context)/i,
];

// Signals that the failure is about the *output*/completion budget itself (the
// named parameter), which shrinking the input cannot fix.
const OUTPUT_BUDGET_PATTERNS = [
	/max_tokens/i,
	/max_completion_tokens/i,
	/max(?:imum)? output tokens/i,
	/output token limit/i,
];

// Only walk fields that legitimately carry provider/HTTP error information. We
// deliberately exclude request-echo containers (e.g. `data`, `body`, request
// payloads) so an echoed user prompt can never be mistaken for a provider error.
const ERROR_MESSAGE_KEYS = [
	"message",
	"code",
	"type",
	"status",
	"statusText",
	"providerCode",
	"error",
	"response",
	"json",
	"cause",
] as const;

function collectErrorMessages(
	error: unknown,
	seen = new Set<unknown>()
): string[] {
	if (error === null || error === undefined || seen.has(error)) return [];
	seen.add(error);

	if (typeof error === "string") return [error];
	if (typeof error !== "object") return [String(error)];

	const record = error as Record<string, unknown>;
	const messages: string[] = [];

	for (const key of ERROR_MESSAGE_KEYS) {
		const value = record[key];
		if (value !== undefined) {
			messages.push(...collectErrorMessages(value, seen));
		}
	}

	return messages;
}

function parseTokenCount(raw: string): number {
	return Number(raw.replace(/,/g, ""));
}

function parseContextLimit(message: string): number | null {
	const match = message.match(
		/context (?:length|window)(?:\s+is)?(?:\s+of)?\s*(\d[\d,]*)/i
	);
	return match ? parseTokenCount(match[1]) : null;
}

// When a provider spells out the token breakdown, decide whether shrinking the
// input can help. The blocker isn't "which side is bigger" — it's whether the
// requested *output*/completion alone already meets or exceeds the context
// window (in which case no input reduction can ever make it fit). Handles, in
// any clause order:
//   OpenAI:    "...maximum context length is 8192... (1000 in the messages, 8000 in the completion)"
//   Anthropic: "input length and max_tokens exceed context limit: 202000 + 4096 > 204698"
function analyzeTokenBreakdown(message: string): "input" | "output" | null {
	const completionMatch = message.match(
		/(\d[\d,]*)\s*(?:tokens?\s+)?in the completion\b/i
	);
	if (completionMatch) {
		const completion = parseTokenCount(completionMatch[1]);
		const context = parseContextLimit(message);
		// Without a stated context we can't be sure; prefer a (cap-bounded) retry.
		if (context === null) return "input";
		return completion >= context ? "output" : "input";
	}

	const arithmetic = message.match(
		/input length and max_tokens exceed context limit:?\s*(\d[\d,]*)\s*\+\s*(\d[\d,]*)(?:\s*>\s*(\d[\d,]*))?/i
	);
	if (arithmetic) {
		const maxTokens = parseTokenCount(arithmetic[2]);
		const context = arithmetic[3] ? parseTokenCount(arithmetic[3]) : null;
		if (context === null) return "input";
		return maxTokens >= context ? "output" : "input";
	}

	return null;
}

export type ProviderErrorKind = "input_context" | "output_budget" | "other";

/**
 * Classify a provider/HTTP error. A spelled-out token breakdown (which side
 * dominates) is authoritative; otherwise fall back to keyword signals, where
 * output/quota signals win over input-context signals because a request that
 * fails on the completion budget cannot be salvaged by sending less input.
 */
export function classifyProviderError(error: unknown): ProviderErrorKind {
	const message = collectErrorMessages(error).join(" ");

	const breakdown = analyzeTokenBreakdown(message);
	if (breakdown === "output") return "output_budget";
	if (breakdown === "input") return "input_context";

	if (OUTPUT_BUDGET_PATTERNS.some((pattern) => pattern.test(message))) {
		return "output_budget";
	}

	if (INPUT_CONTEXT_LIMIT_PATTERNS.some((pattern) => pattern.test(message))) {
		return "input_context";
	}

	return "other";
}

/**
 * True only when the provider rejected the request because the *input* exceeded
 * the model's context window — the one case where retrying with smaller chunks
 * can help.
 */
export function isLikelyContextLimitError(error: unknown): boolean {
	return classifyProviderError(error) === "input_context";
}

export interface NormalizedProviderError extends Error {
	status: number;
	providerCode?: string;
}

type MinimalRequestUrlResponse = {
	status: number;
	json?: unknown;
	text?: string;
};

/**
 * Build a structured error from a failed `requestUrl` response (called with
 * `throw: false`). The provider's real `code`/`message` are embedded in the
 * thrown error's message and `providerCode`, so classification and user-facing
 * messaging both work.
 */
export function buildProviderError(
	providerName: string,
	response: MinimalRequestUrlResponse
): NormalizedProviderError {
	let detail = "";
	let code = "";

	let parsed: unknown;
	try {
		parsed = response.json;
	} catch {
		parsed = undefined;
	}

	if (parsed && typeof parsed === "object") {
		const root = parsed as Record<string, unknown>;
		const errObj = (root.error ?? root) as Record<string, unknown>;
		detail = String(errObj.message ?? root.message ?? "");
		code = String(errObj.code ?? errObj.type ?? errObj.status ?? "");
	}

	if (!detail) {
		detail =
			typeof response.text === "string" && response.text.length > 0
				? response.text
				: `HTTP ${response.status}`;
	}

	const err = new Error(
		`${providerName} request failed (HTTP ${response.status})${
			code ? ` [${code}]` : ""
		}: ${detail}`
	) as NormalizedProviderError;
	err.status = response.status;
	if (code) err.providerCode = code;
	return err;
}
