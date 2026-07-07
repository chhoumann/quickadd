import { beforeEach, describe, expect, it, vi } from "vitest";
import type { App } from "obsidian";
import type { AIProvider, Model } from "./Provider";

const storeState = vi.hoisted(() => ({
	disableOnlineFeatures: false,
}));

const mocks = vi.hoisted(() => ({
	requestUrlMock: vi.fn(),
	beginAIRequestLogEntryMock: vi.fn(),
	finishAIRequestLogEntryMock: vi.fn(),
	getModelProviderMock: vi.fn(),
	logMessageMock: vi.fn(),
	logErrorMock: vi.fn(),
	noticeMock: vi.fn(),
}));

vi.mock("obsidian", () => ({
	requestUrl: mocks.requestUrlMock,
	Notice: mocks.noticeMock,
}));

vi.mock("src/settingsStore", () => ({
	settingsStore: {
		getState: () => storeState,
	},
}));

vi.mock("./AIAssistant", () => ({
	beginAIRequestLogEntry: mocks.beginAIRequestLogEntryMock,
	finishAIRequestLogEntry: mocks.finishAIRequestLogEntryMock,
}));

vi.mock("./aiHelpers", () => ({
	getModelProvider: mocks.getModelProviderMock,
}));

vi.mock("src/logger/logManager", () => ({
	log: {
		logMessage: mocks.logMessageMock,
		logError: mocks.logErrorMock,
	},
}));

const { requestUrlMock, getModelProviderMock, noticeMock } = mocks;

const { OpenAIRequest, chatRequest } = await import("./OpenAIRequest");

// OpenAIRequest/chatRequest now take the caller-resolved provider explicitly
// (#1495); these tests keep selecting it via getModelProviderMock.
const currentProvider = () => getModelProviderMock() as AIProvider;

function makeApp(): App {
	return {
		workspace: {
			activeEditor: undefined,
		},
	} as unknown as App;
}

const openaiProvider = {
	name: "OpenAI",
	endpoint: "https://api.openai.com/v1",
	kind: "openai" as const,
	apiKey: "sk",
	models: [],
	modelSource: "modelsDev" as const,
};

const anthropicProvider = {
	name: "Anthropic",
	endpoint: "https://api.anthropic.com",
	kind: "anthropic" as const,
	apiKey: "sk-ant",
	models: [],
	modelSource: "providerApi" as const,
};

function openaiSuccess(content = "ok") {
	return {
		status: 200,
		json: Promise.resolve({
			id: "1",
			model: "m",
			choices: [
				{ finish_reason: "stop", index: 0, message: { content, role: "assistant" } },
			],
			usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
			created: 0,
		}),
	};
}

// Exact live shape from o3-mini (2026-07-07).
function unsupportedParamFailure(param = "temperature") {
	return {
		status: 400,
		// Obsidian's requestUrl exposes `json` as a plain property on responses.
		json: {
			error: {
				message: `Unsupported parameter: '${param}' is not supported with this model.`,
				type: "invalid_request_error",
				param,
				code: "unsupported_parameter",
			},
		},
	};
}

function sentBody(callIndex: number): Record<string, unknown> {
	return JSON.parse(requestUrlMock.mock.calls[callIndex][0].body as string);
}

describe("sampling parameter recovery (single-prompt path)", () => {
	beforeEach(() => {
		requestUrlMock.mockReset();
		getModelProviderMock.mockReset();
		noticeMock.mockReset();
		storeState.disableOnlineFeatures = false;
	});

	it("retries once without sampling params when the provider rejects them, and notifies", async () => {
		getModelProviderMock.mockReturnValue(openaiProvider);
		requestUrlMock
			.mockReturnValueOnce(Promise.resolve(unsupportedParamFailure()))
			.mockReturnValueOnce(Promise.resolve(openaiSuccess("recovered")));

		const model: Model = { name: "o3-mini", maxTokens: 200000 };
		const makeRequest = OpenAIRequest(makeApp(), "sk", model, currentProvider(), "sys", {
			temperature: 0.7,
		});

		const res = await makeRequest("hello");

		expect(res.content).toBe("recovered");
		expect(requestUrlMock).toHaveBeenCalledTimes(2);
		expect(sentBody(0).temperature).toBe(0.7);
		expect(sentBody(1).temperature).toBeUndefined();
		expect(noticeMock).toHaveBeenCalledTimes(1);
		expect(String(noticeMock.mock.calls[0][0])).toContain("Temperature");
	});

	it("skips sampling params proactively when the model's metadata marks them unsupported", async () => {
		getModelProviderMock.mockReturnValue(openaiProvider);
		requestUrlMock.mockReturnValueOnce(Promise.resolve(openaiSuccess()));

		const model: Model = {
			name: "gpt-5.5",
			maxTokens: 1050000,
			supportsTemperature: false,
		};
		const makeRequest = OpenAIRequest(makeApp(), "sk", model, currentProvider(), "sys", {
			temperature: 0.3,
			top_p: 0.9,
		});

		await makeRequest("hello");

		expect(requestUrlMock).toHaveBeenCalledTimes(1);
		const body = sentBody(0);
		expect(body.temperature).toBeUndefined();
		expect(body.top_p).toBeUndefined();
		expect(noticeMock).not.toHaveBeenCalled();
	});

	it("does not retry unrelated 400s", async () => {
		getModelProviderMock.mockReturnValue(openaiProvider);
		requestUrlMock.mockReturnValueOnce(
			Promise.resolve({
				status: 404,
				json: {
					error: {
						message:
							"The model `gpt-4-32k` does not exist or you do not have access to it.",
						type: "invalid_request_error",
						code: "model_not_found",
					},
				},
			}),
		);

		const model: Model = { name: "gpt-4-32k", maxTokens: 32768 };
		const makeRequest = OpenAIRequest(makeApp(), "sk", model, currentProvider(), "sys", {
			temperature: 0.7,
		});

		await expect(makeRequest("hello")).rejects.toThrow("does not exist");
		expect(requestUrlMock).toHaveBeenCalledTimes(1);
		expect(noticeMock).not.toHaveBeenCalled();
	});

	it("does not retry when no sampling params were sent", async () => {
		getModelProviderMock.mockReturnValue(openaiProvider);
		requestUrlMock.mockReturnValueOnce(
			Promise.resolve(unsupportedParamFailure()),
		);

		const model: Model = { name: "o3-mini", maxTokens: 200000 };
		const makeRequest = OpenAIRequest(makeApp(), "sk", model, currentProvider(), "sys", {});

		await expect(makeRequest("hello")).rejects.toThrow("Unsupported parameter");
		expect(requestUrlMock).toHaveBeenCalledTimes(1);
	});
});

describe("Anthropic single-prompt sampling + output cap", () => {
	beforeEach(() => {
		requestUrlMock.mockReset();
		getModelProviderMock.mockReset();
		noticeMock.mockReset();
		storeState.disableOnlineFeatures = false;
	});

	function anthropicSuccess() {
		return {
			status: 200,
			json: Promise.resolve({
				id: "1",
				model: "claude-haiku-4-5",
				role: "assistant",
				type: "message",
				content: [{ type: "text", text: "hi" }],
				stop_reason: "end_turn",
				stop_sequence: null,
				usage: { input_tokens: 1, output_tokens: 1 },
			}),
		};
	}

	it("forwards a set temperature and uses the model's real output cap", async () => {
		getModelProviderMock.mockReturnValue(anthropicProvider);
		requestUrlMock.mockReturnValueOnce(Promise.resolve(anthropicSuccess()));

		const model: Model = {
			name: "claude-haiku-4-5",
			maxTokens: 200000,
			maxOutputTokens: 64000,
			supportsTemperature: true,
		};
		const makeRequest = OpenAIRequest(makeApp(), "sk-ant", model, currentProvider(), "sys", {
			temperature: 0.4,
		});

		await makeRequest("hello");

		const body = sentBody(0);
		expect(body.temperature).toBe(0.4);
		expect(body.max_tokens).toBe(64000);
		// OpenAI-only params must never reach the Messages API.
		expect(body.frequency_penalty).toBeUndefined();
	});

	it("recovers when a current Claude model rejects temperature", async () => {
		getModelProviderMock.mockReturnValue(anthropicProvider);
		requestUrlMock
			.mockReturnValueOnce(
				Promise.resolve({
					status: 400,
					json: {
						type: "error",
						error: {
							type: "invalid_request_error",
							message: "`temperature` is deprecated for this model.",
						},
					},
				}),
			)
			.mockReturnValueOnce(Promise.resolve(anthropicSuccess()));

		// No metadata (e.g. user-added model): the reactive retry is the net.
		const model: Model = { name: "claude-sonnet-5", maxTokens: 1000000 };
		const makeRequest = OpenAIRequest(makeApp(), "sk-ant", model, currentProvider(), "sys", {
			temperature: 0.7,
		});

		const res = await makeRequest("hello");

		expect(res.content).toBe("hi");
		expect(requestUrlMock).toHaveBeenCalledTimes(2);
		expect(sentBody(0).temperature).toBe(0.7);
		expect(sentBody(1).temperature).toBeUndefined();
		expect(noticeMock).toHaveBeenCalledTimes(1);
	});
});

describe("sampling parameter recovery (chat/tool path)", () => {
	beforeEach(() => {
		requestUrlMock.mockReset();
		getModelProviderMock.mockReset();
		noticeMock.mockReset();
		storeState.disableOnlineFeatures = false;
	});

	it("retries the chat request without sampling params on rejection", async () => {
		getModelProviderMock.mockReturnValue(openaiProvider);
		requestUrlMock
			.mockReturnValueOnce(Promise.resolve(unsupportedParamFailure("top_p")))
			.mockReturnValueOnce(Promise.resolve(openaiSuccess("chat ok")));

		const model: Model = { name: "o4-mini", maxTokens: 200000 };
		const res = await chatRequest(makeApp(), "sk", model, currentProvider(), {
			messages: [{ role: "user", content: "hello" }],
			modelParams: { top_p: 0.5 },
		});

		expect(res.content).toBe("chat ok");
		expect(requestUrlMock).toHaveBeenCalledTimes(2);
		expect(sentBody(0).top_p).toBe(0.5);
		expect(sentBody(1).top_p).toBeUndefined();
		expect(noticeMock).toHaveBeenCalledTimes(1);
	});
});
