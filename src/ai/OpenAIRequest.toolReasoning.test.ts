import { beforeEach, describe, expect, it } from "vitest";
import type { AIProvider, Model } from "./Provider";
import type { NormalizedChatRequest } from "./tools/NormalizedTools";

import { storeState, mocks, makeApp } from "../../tests/helpers/ai/requestHarness";

const { requestUrlMock, noticeMock } = mocks;

const { chatRequest } = await import("./OpenAIRequest");

// A gateway serving OpenAI models over Chat Completions (OpenAI's own endpoint
// uses the Responses API, where this rejection doesn't happen).
const gatewayProvider: AIProvider = {
	name: "Gateway",
	endpoint: "https://openrouter.ai/api/v1",
	kind: "openai",
	apiKey: "sk",
	models: [],
	modelSource: "modelsDev",
};

const gpt6: Model = {
	name: "gpt-6-sol",
	maxTokens: 1_050_000,
	maxOutputTokens: 128_000,
	supportsTemperature: false,
};

// Exact live error for gpt-6-sol with function tools on /v1/chat/completions
// (2026-09-26); gpt-5.6-* and the other gpt-6-* models return the same text.
function toolsWhileReasoningFailure(model = "gpt-6-sol") {
	return {
		status: 400,
		json: {
			error: {
				message: `Function tools with reasoning_effort are not supported for ${model} in /v1/chat/completions. To use function tools, use /v1/responses or set reasoning_effort to 'none'.`,
				type: "invalid_request_error",
				param: null,
				code: null,
			},
		},
	};
}

function toolCallSuccess() {
	return {
		status: 200,
		json: Promise.resolve({
			id: "1",
			model: "gpt-6-sol",
			choices: [
				{
					finish_reason: "tool_calls",
					index: 0,
					message: {
						role: "assistant",
						content: null,
						tool_calls: [
							{
								id: "call_1",
								type: "function",
								function: { name: "get_weather", arguments: '{"city":"Paris"}' },
							},
						],
					},
				},
			],
			usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
			created: 0,
		}),
	};
}

function toolRequest(
	modelParams: Record<string, unknown> = {},
): NormalizedChatRequest {
	return {
		messages: [{ role: "user", content: "Weather in Paris?" }],
		modelParams,
		tools: [
			{
				name: "get_weather",
				description: "Get weather",
				parameters: {
					type: "object",
					properties: { city: { type: "string" } },
					required: ["city"],
				},
			},
		],
		toolChoice: "auto",
	};
}

function sentBody(callIndex: number): Record<string, unknown> {
	return JSON.parse(requestUrlMock.mock.calls[callIndex][0].body as string);
}

beforeEach(() => {
	requestUrlMock.mockReset();
	noticeMock.mockReset();
	storeState.disableOnlineFeatures = false;
});

describe("function tools on reasoning models behind a Chat Completions gateway", () => {
	it("retries once with reasoning_effort 'none' when the model rejects tools while reasoning", async () => {
		requestUrlMock
			.mockReturnValueOnce(Promise.resolve(toolsWhileReasoningFailure()))
			.mockReturnValueOnce(Promise.resolve(toolCallSuccess()));

		const res = await chatRequest(makeApp(), "sk", gpt6, gatewayProvider, toolRequest());

		expect(res.toolCalls?.map((call) => call.name)).toEqual(["get_weather"]);
		expect(requestUrlMock).toHaveBeenCalledTimes(2);
		expect(sentBody(0).reasoning_effort).toBeUndefined();
		expect(sentBody(1).reasoning_effort).toBe("none");
		expect(sentBody(1).tools).toEqual(sentBody(0).tools);
	});

	it("keeps a reasoning effort the caller chose and surfaces the error", async () => {
		requestUrlMock.mockReturnValueOnce(
			Promise.resolve(toolsWhileReasoningFailure()),
		);

		await expect(
			chatRequest(
				makeApp(),
				"sk",
				gpt6,
				gatewayProvider,
				toolRequest({ reasoning_effort: "high" }),
			),
		).rejects.toThrow(/reasoning_effort/);
		expect(requestUrlMock).toHaveBeenCalledTimes(1);
	});

	it("does not retry other 400s", async () => {
		requestUrlMock.mockReturnValueOnce(
			Promise.resolve({
				status: 400,
				json: {
					error: {
						message: "Invalid schema for function 'get_weather'.",
						type: "invalid_request_error",
					},
				},
			}),
		);

		await expect(
			chatRequest(makeApp(), "sk", gpt6, gatewayProvider, toolRequest()),
		).rejects.toThrow(/Invalid schema/);
		expect(requestUrlMock).toHaveBeenCalledTimes(1);
	});

	it("retries at the gateway's Chat Completions URL", async () => {
		requestUrlMock
			.mockReturnValueOnce(Promise.resolve(toolsWhileReasoningFailure()))
			.mockReturnValueOnce(Promise.resolve(toolCallSuccess()));

		await chatRequest(makeApp(), "sk", gpt6, gatewayProvider, toolRequest());

		expect(requestUrlMock.mock.calls.map((call) => call[0].url)).toEqual([
			"https://openrouter.ai/api/v1/chat/completions",
			"https://openrouter.ai/api/v1/chat/completions",
		]);
	});

	it("does not add reasoning_effort to a request without tools", async () => {
		requestUrlMock.mockReturnValueOnce(
			Promise.resolve(toolsWhileReasoningFailure()),
		);

		await expect(
			chatRequest(makeApp(), "sk", gpt6, gatewayProvider, {
				messages: [{ role: "user", content: "hi" }],
			}),
		).rejects.toThrow();
		expect(requestUrlMock).toHaveBeenCalledTimes(1);
	});
});
