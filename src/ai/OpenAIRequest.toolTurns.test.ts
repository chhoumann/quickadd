import { beforeEach, describe, expect, it } from "vitest";
import type { AIProvider, Model } from "./Provider";
import type { NormalizedChatRequest } from "./tools/NormalizedTools";

import { storeState, mocks, makeApp } from "../../tests/helpers/ai/requestHarness";

const { requestUrlMock, noticeMock } = mocks;

const { chatRequest } = await import("./OpenAIRequest");

function openaiCompatible(endpoint: string, name = "OpenAI"): AIProvider {
	return { name, endpoint, kind: "openai", apiKey: "sk", models: [], modelSource: "modelsDev" };
}

const gpt6: Model = {
	name: "gpt-6-luna",
	maxTokens: 1_050_000,
	maxOutputTokens: 128_000,
	supportsTemperature: false,
};

const weatherTool = {
	name: "get_weather",
	description: "Get weather",
	parameters: {
		type: "object" as const,
		properties: { city: { type: "string" as const } },
		required: ["city"],
	},
};

function toolRequest(): NormalizedChatRequest {
	return {
		messages: [
			{ role: "system", content: "Use tools." },
			{ role: "user", content: "Weather in Paris?" },
		],
		tools: [weatherTool],
		toolChoice: "auto",
	};
}

// Shape of a live /v1/responses reply from a reasoning model (2026-09-26):
// a reasoning item with encrypted_content, then a function_call whose item
// `id` (fc_…) differs from the `call_id` the result must reference.
const responsesToolCallOutput = [
	{ id: "rs_1", type: "reasoning", summary: [], encrypted_content: "opaque-blob" },
	{
		id: "fc_1",
		type: "function_call",
		status: "completed",
		call_id: "call_abc",
		name: "get_weather",
		arguments: '{"city":"Paris"}',
	},
];

function ok(json: unknown) {
	return Promise.resolve({ status: 200, json: Promise.resolve(json) });
}

function sent(callIndex: number): { url: string; body: Record<string, unknown> } {
	const arg = requestUrlMock.mock.calls[callIndex][0];
	return { url: arg.url as string, body: JSON.parse(arg.body as string) };
}

beforeEach(() => {
	requestUrlMock.mockReset();
	noticeMock.mockReset();
	storeState.disableOnlineFeatures = false;
});

describe("OpenAI tool turns use the Responses API on api.openai.com", () => {
	it("sends a tool turn to /v1/responses and returns the call under its call_id", async () => {
		requestUrlMock.mockReturnValueOnce(
			ok({
				id: "resp_1",
				status: "completed",
				output: responsesToolCallOutput,
				usage: { input_tokens: 10, output_tokens: 5, total_tokens: 15 },
			}),
		);

		const res = await chatRequest(
			makeApp(), "sk", gpt6, openaiCompatible("https://api.openai.com/v1"), toolRequest(),
		);

		const { url, body } = sent(0);
		expect(url).toBe("https://api.openai.com/v1/responses");
		expect(body.messages).toBeUndefined();
		expect(body.reasoning_effort).toBeUndefined();
		expect(body.store).toBe(false);
		expect(body.tools).toEqual([
			{ type: "function", name: "get_weather", description: "Get weather", parameters: weatherTool.parameters, strict: false },
		]);
		expect(res.toolCalls).toEqual([
			{ id: "call_abc", name: "get_weather", args: { city: "Paris" }, rawArgs: '{"city":"Paris"}' },
		]);
		expect(res.normalizedStopReason).toBe("tool_calls");
		expect(res.usage).toEqual({ promptTokens: 10, completionTokens: 5, totalTokens: 15 });
		expect(res.providerRaw).toEqual(responsesToolCallOutput);
	});

	it("echoes the previous turn's output items and answers with function_call_output", async () => {
		requestUrlMock.mockReturnValueOnce(
			ok({
				id: "resp_2",
				status: "completed",
				output: [
					{ id: "msg_1", type: "message", role: "assistant", content: [{ type: "output_text", text: "Sunny, 21°C." }] },
				],
				usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 },
			}),
		);

		const req = toolRequest();
		req.messages.push(
			{
				role: "assistant",
				content: "",
				toolCalls: [{ id: "call_abc", name: "get_weather", args: { city: "Paris" } }],
				providerRaw: responsesToolCallOutput,
			},
			{ role: "tool", results: [{ toolCallId: "call_abc", name: "get_weather", content: "sunny" }] },
		);
		const res = await chatRequest(
			makeApp(), "sk", gpt6, openaiCompatible("https://api.openai.com/v1"), req,
		);

		expect(sent(0).body.input).toEqual([
			{ role: "system", content: "Use tools." },
			{ role: "user", content: "Weather in Paris?" },
			...responsesToolCallOutput,
			{ type: "function_call_output", call_id: "call_abc", output: "sunny" },
		]);
		expect(res.content).toBe("Sunny, 21°C.");
		expect(res.normalizedStopReason).toBe("stop");
	});

	it("does not retry with reasoning_effort when OpenAI rejects a tool turn", async () => {
		requestUrlMock.mockReturnValueOnce(
			Promise.resolve({
				status: 400,
				json: { error: { message: "Invalid schema for function 'get_weather'.", type: "invalid_request_error" } },
			}),
		);

		await expect(
			chatRequest(makeApp(), "sk", gpt6, openaiCompatible("https://api.openai.com/v1"), toolRequest()),
		).rejects.toThrow(/Invalid schema/);
		expect(requestUrlMock).toHaveBeenCalledTimes(1);
	});
});

describe("OpenAI-compatible endpoints keep Chat Completions", () => {
	it.each([
		["a third-party endpoint", "https://api.groq.com/openai/v1"],
		["a proxy named OpenAI", "https://llm-proxy.example/v1"],
		["a lookalike host", "https://api.openai.com.evil.example/v1"],
	])("%s", async (_label, endpoint) => {
		requestUrlMock.mockReturnValueOnce(
			ok({
				id: "1",
				model: "m",
				choices: [
					{
						finish_reason: "tool_calls",
						index: 0,
						message: {
							role: "assistant",
							content: null,
							tool_calls: [{ id: "call_1", type: "function", function: { name: "get_weather", arguments: '{"city":"Paris"}' } }],
						},
					},
				],
				usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
			}),
		);

		const res = await chatRequest(makeApp(), "sk", gpt6, openaiCompatible(endpoint), toolRequest());

		const { url, body } = sent(0);
		expect(url).toBe(`${endpoint}/chat/completions`);
		expect(Array.isArray(body.messages)).toBe(true);
		expect(body.input).toBeUndefined();
		expect(res.toolCalls?.map((call) => call.id)).toEqual(["call_1"]);
	});
});

describe("Anthropic models that reject forced tool use", () => {
	const anthropic: AIProvider = {
		name: "Anthropic",
		endpoint: "https://api.anthropic.com",
		kind: "anthropic",
		apiKey: "sk",
		models: [],
		modelSource: "modelsDev",
	};
	const opus55: Model = { name: "claude-opus-5-5", maxTokens: 1_000_000, maxOutputTokens: 128_000 };

	function anthropic400(message: string) {
		return Promise.resolve({
			status: 400,
			json: { type: "error", error: { type: "invalid_request_error", message } },
		});
	}

	it("explains the documented 400 and how to fix the call", async () => {
		// Exact text from https://platform.claude.com/docs/en/api/errors#forced-tool-use-not-supported
		requestUrlMock.mockReturnValueOnce(
			anthropic400('tool_choice: type "tool" and "any" are not supported for this model.'),
		);

		const error = await chatRequest(makeApp(), "sk", opus55, anthropic, {
			...toolRequest(),
			toolChoice: "required",
		}).catch((e: Error) => e);

		expect(sent(0).body.tool_choice).toEqual({ type: "any" });
		expect(requestUrlMock).toHaveBeenCalledTimes(1);
		expect(String(error)).toContain(
			'claude-opus-5-5 can\'t be forced to call a tool, so toolChoice "required" and named tools don\'t work with it. Use toolChoice "auto"',
		);
	});

	it("leaves other tool_choice errors alone", async () => {
		requestUrlMock.mockReturnValueOnce(
			anthropic400("tool_choice.name: Tool 'missing' not found in tools."),
		);

		const error = await chatRequest(makeApp(), "sk", opus55, anthropic, {
			...toolRequest(),
			toolChoice: { name: "missing" },
		}).catch((e: Error) => e);

		expect(String(error)).toContain("not found in tools");
		expect(String(error)).not.toContain("can't be forced");
	});
});
