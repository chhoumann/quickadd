import { describe, expect, it } from "vitest";
import {
	applySamplingSupport,
	describeSamplingParams,
	isUnsupportedSamplingParamError,
	sentSamplingParams,
	stripSamplingParams,
} from "./samplingParams";

describe("sentSamplingParams", () => {
	it("lists only numerically-set sampling keys", () => {
		expect(
			sentSamplingParams({ temperature: 0.7, frequency_penalty: 0 }),
		).toEqual(["temperature", "frequency_penalty"]);
		expect(sentSamplingParams({})).toEqual([]);
		expect(
			sentSamplingParams({ temperature: undefined as unknown as number }),
		).toEqual([]);
	});
});

describe("stripSamplingParams", () => {
	it("removes every sampling key and keeps the rest", () => {
		const params = {
			temperature: 0.5,
			top_p: 0.9,
			frequency_penalty: 1,
			presence_penalty: 1,
		};
		expect(stripSamplingParams(params)).toEqual({});
		// original untouched
		expect(params.temperature).toBe(0.5);
	});
});

describe("applySamplingSupport", () => {
	it("drops sampling params when the model marks them unsupported", () => {
		expect(
			applySamplingSupport(
				{ supportsTemperature: false },
				{ temperature: 0.2, top_p: 0.9 },
			),
		).toEqual({});
	});

	it("keeps params when support is true or unknown", () => {
		expect(
			applySamplingSupport(
				{ supportsTemperature: true },
				{ temperature: 0.2 },
			),
		).toEqual({ temperature: 0.2 });
		expect(
			applySamplingSupport({}, { temperature: 0.2 }),
		).toEqual({ temperature: 0.2 });
	});
});

describe("isUnsupportedSamplingParamError", () => {
	// Exact provider messages captured live on 2026-07-07.
	const liveMessages = [
		// OpenAI reasoning family (o3-mini)
		"OpenAI request failed (HTTP 400) [unsupported_parameter]: Unsupported parameter: 'temperature' is not supported with this model.",
		// OpenAI gpt-5.5 with a non-default value
		"OpenAI request failed (HTTP 400) [unsupported_value]: Unsupported value: 'temperature' does not support 0.7 with this model. Only the default (1) value is supported.",
		// OpenAI gpt-5.5 frequency penalty
		"OpenAI request failed (HTTP 400) [unsupported_parameter]: Unsupported parameter: 'frequency_penalty' is not supported with this model.",
		// Anthropic current generation (claude-sonnet-5)
		"Anthropic request failed (HTTP 400) [invalid_request_error]: `temperature` is deprecated for this model.",
		"Anthropic request failed (HTTP 400) [invalid_request_error]: `top_p` is deprecated for this model.",
	];

	it.each(liveMessages)("matches live provider rejection: %s", (message) => {
		expect(
			isUnsupportedSamplingParamError(message, ["temperature", "top_p", "frequency_penalty"]),
		).toBe(true);
	});

	it("matches OpenAI-compatible server phrasings", () => {
		expect(
			isUnsupportedSamplingParamError(
				"Unrecognized request argument supplied: top_p",
				["top_p"],
			),
		).toBe(true);
		expect(
			isUnsupportedSamplingParamError(
				"temperature: Extra inputs are not permitted",
				["temperature"],
			),
		).toBe(true);
	});

	it("never triggers when no sampling params were sent", () => {
		expect(
			isUnsupportedSamplingParamError(
				"Unsupported parameter: 'temperature' is not supported with this model.",
				[],
			),
		).toBe(false);
	});

	it("ignores unrelated 400s", () => {
		expect(
			isUnsupportedSamplingParamError(
				"The model `gpt-4-32k` does not exist or you do not have access to it.",
				["temperature"],
			),
		).toBe(false);
		expect(
			isUnsupportedSamplingParamError(
				"input length and max_tokens exceed context limit: 202000 + 4096 > 204698",
				["temperature"],
			),
		).toBe(false);
		// A context error that merely mentions the word temperature elsewhere.
		expect(
			isUnsupportedSamplingParamError(
				"maximum context length is 8192 tokens",
				["temperature"],
			),
		).toBe(false);
	});
});

describe("describeSamplingParams", () => {
	it("formats one, two, and many params", () => {
		expect(describeSamplingParams(["temperature"])).toBe("Temperature");
		expect(describeSamplingParams(["temperature", "top_p"])).toBe(
			"Temperature and Top P",
		);
		expect(
			describeSamplingParams(["temperature", "top_p", "presence_penalty"]),
		).toBe("Temperature, Top P, and Presence Penalty");
	});
});
