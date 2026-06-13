import { describe, expect, it } from "vitest";
import {
	buildProviderError,
	classifyProviderError,
	isLikelyContextLimitError,
} from "./providerErrors";

describe("classifyProviderError", () => {
	it("classifies common input-context messages as input_context", () => {
		expect(
			isLikelyContextLimitError(new Error("maximum context length exceeded"))
		).toBe(true);
		expect(isLikelyContextLimitError("too many input tokens")).toBe(true);
		expect(
			classifyProviderError({
				response: { json: { error: { code: "context_length_exceeded" } } },
			})
		).toBe("input_context");
	});

	it("classifies Gemini input-token overflow as input_context", () => {
		// Real Gemini 400 shape.
		const geminiError = new Error(
			"The input token count (2551556) exceeds the maximum number of tokens allowed (1048576)."
		);
		expect(classifyProviderError(geminiError)).toBe("input_context");
	});

	it("walks wrapped causes and ignores unrelated errors", () => {
		const cause = new Error("context_length_exceeded");
		const wrapped = new Error("Error while making request", { cause });
		expect(isLikelyContextLimitError(wrapped)).toBe(true);
		expect(isLikelyContextLimitError(new Error("network down"))).toBe(false);
	});

	it("does not classify quota or explicit output-token errors as input_context", () => {
		expect(classifyProviderError("rate limit exceeded")).toBe("other");
		expect(classifyProviderError("token limit quota exceeded")).toBe("other");
		expect(classifyProviderError("max output tokens exceeded")).toBe(
			"output_budget"
		);
		expect(
			classifyProviderError("max_tokens is too large: 200000")
		).toBe("output_budget");
	});

	it("treats a completion that alone exceeds the context as output_budget (no retry)", () => {
		// completion 9000 >= context 8192 → no input reduction can ever make it fit.
		const completionExceedsContext = new Error(
			"This model's maximum context length is 8192 tokens. However, you requested 9500 tokens (500 in the messages, 9000 in the completion). Please reduce the length of the messages or completion."
		);
		expect(classifyProviderError(completionExceedsContext)).toBe(
			"output_budget"
		);
		expect(isLikelyContextLimitError(completionExceedsContext)).toBe(false);
	});

	it("treats a mixed overflow whose completion fits the context as input_context", () => {
		// completion 4500 < context 8192 → shrinking the input can bring it under.
		const mixedButRetryable = new Error(
			"This model's maximum context length is 8192 tokens. However, you requested 8500 tokens (4000 in the messages, 4500 in the completion)."
		);
		expect(classifyProviderError(mixedButRetryable)).toBe("input_context");
		expect(isLikelyContextLimitError(mixedButRetryable)).toBe(true);
	});

	it("treats a messages-dominated overflow as input_context (retry can help)", () => {
		const messagesDominated = new Error(
			"This model's maximum context length is 8192 tokens. However, you requested 9100 tokens (9000 in the messages, 100 in the completion). Please reduce the length of the messages or completion."
		);
		expect(classifyProviderError(messagesDominated)).toBe("input_context");
		expect(isLikelyContextLimitError(messagesDominated)).toBe(true);
	});

	it("parses the completion/context comparison regardless of clause order", () => {
		const completionFirst = new Error(
			"maximum context length is 8192 tokens; requested 12,000 tokens (11,000 in the completion and 1,000 in the messages)"
		);
		expect(classifyProviderError(completionFirst)).toBe("output_budget");
	});

	it("treats an Anthropic input-dominated arithmetic overflow as input_context", () => {
		// max_tokens (4096) < context (204698): shrinking the input can fit it.
		const anthropic = new Error(
			"input length and max_tokens exceed context limit: 202000 + 4096 > 204698, decrease input length or max_tokens"
		);
		expect(classifyProviderError(anthropic)).toBe("input_context");
	});

	it("treats an Anthropic overflow whose max_tokens alone exceeds context as output_budget", () => {
		const anthropic = new Error(
			"input length and max_tokens exceed context limit: 1000 + 300000 > 204698, decrease input length or max_tokens"
		);
		expect(classifyProviderError(anthropic)).toBe("output_budget");
	});

	it("treats an oversized max_tokens (no breakdown) as output_budget", () => {
		const tooLarge = new Error(
			"max_tokens is too large: 200000. This model supports at most 16384 completion tokens"
		);
		expect(classifyProviderError(tooLarge)).toBe("output_budget");
	});

	it("ignores echoed prompt text in request-payload fields", () => {
		// Real error is a 500; the user's prompt (mentioning "context window") is
		// echoed in request-payload containers we deliberately do not walk.
		const echoed500 = {
			message: "Request failed, status 500",
			response: {
				json: {
					error: { message: "Internal server error", code: "internal_error" },
				},
			},
			data: { message: "Explain the context window of GPT-4" },
			body: "prompt: explain the context window",
		};
		expect(isLikelyContextLimitError(echoed500)).toBe(false);
	});
});

describe("buildProviderError", () => {
	it("embeds the provider code and message and exposes status", () => {
		const err = buildProviderError("OpenAI", {
			status: 400,
			json: {
				error: {
					code: "context_length_exceeded",
					message: "maximum context length exceeded",
				},
			},
		});
		expect(err.message).toContain("context_length_exceeded");
		expect(err.message).toContain("maximum context length exceeded");
		expect(err.status).toBe(400);
		expect(err.providerCode).toBe("context_length_exceeded");
		expect(isLikelyContextLimitError(err)).toBe(true);
	});

	it("falls back to response text when the body is not JSON", () => {
		const err = buildProviderError("Gemini", {
			status: 503,
			get json() {
				throw new Error("not json");
			},
			text: "upstream connect error",
		});
		expect(err.message).toContain("upstream connect error");
		expect(err.status).toBe(503);
	});
});
