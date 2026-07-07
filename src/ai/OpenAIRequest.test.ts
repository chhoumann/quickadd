import { beforeEach, describe, expect, it, vi } from "vitest";
import type { App } from "obsidian";
import type { AIProvider, Model } from "./Provider";
import {
	classifyProviderError,
	isLikelyContextLimitError,
} from "./providerErrors";

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
}));

vi.mock("obsidian", () => ({
	requestUrl: mocks.requestUrlMock,
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

const {
	requestUrlMock,
	beginAIRequestLogEntryMock,
	finishAIRequestLogEntryMock,
	getModelProviderMock,
	logErrorMock,
} = mocks;

const { OpenAIRequest } = await import("./OpenAIRequest");

// OpenAIRequest now takes the caller-resolved provider explicitly (#1495);
// these tests keep selecting it via getModelProviderMock and read it back here.
const currentProvider = () => getModelProviderMock() as AIProvider;

// A minimal app whose activeEditor is undefined so preventCursorChange becomes a no-op.
function makeApp(): App {
	return {
		workspace: {
			activeEditor: undefined,
		},
	} as unknown as App;
}

// An app whose editor records setCursor/setSelections calls so we can assert
// preventCursorChange restores cursor state after dispatching the request.
function makeAppWithEditor() {
	const calls = {
		setCursor: vi.fn(),
		setSelections: vi.fn(),
	};
	const cursor = { line: 3, ch: 7 };
	const selections = [{ anchor: { line: 1, ch: 0 }, head: { line: 2, ch: 4 } }];
	const app = {
		workspace: {
			activeEditor: {
				editor: {
					getCursor: () => cursor,
					listSelections: () => selections,
					setCursor: calls.setCursor,
					setSelections: calls.setSelections,
				},
			},
		},
	} as unknown as App;

	return { app, calls, cursor, selections };
}

const openAIModel: Model = { name: "gpt-4o", maxTokens: 128000 };
const anthropicModel: Model = { name: "claude-3-5-sonnet", maxTokens: 200000 };
const geminiModel: Model = { name: "gemini-1.5-pro", maxTokens: 1000000 };

const openAIProvider = {
	name: "OpenAI",
	endpoint: "https://api.openai.com/v1",
};
const anthropicProvider = {
	name: "Anthropic",
	endpoint: "https://api.anthropic.com",
};
const geminiProvider = {
	name: "Gemini",
	endpoint: "https://generativelanguage.googleapis.com",
};

function openAIResponse(overrides: Record<string, unknown> = {}) {
	return {
		id: "chatcmpl-123",
		model: "gpt-4o",
		object: "chat.completion",
		usage: {
			prompt_tokens: 10,
			completion_tokens: 20,
			total_tokens: 30,
		},
		choices: [
			{
				finish_reason: "stop",
				index: 0,
				message: { content: "Hello there", role: "assistant" },
			},
		],
		created: 1700000000,
		...overrides,
	};
}

beforeEach(() => {
	vi.clearAllMocks();
	storeState.disableOnlineFeatures = false;
	beginAIRequestLogEntryMock.mockReturnValue("log-id-1");
});

describe("OpenAIRequest", () => {
	describe("guard clauses", () => {
		it("throws and does not call requestUrl when online features are disabled", async () => {
			storeState.disableOnlineFeatures = true;
			const makeRequest = OpenAIRequest(
				makeApp(),
				"key",
				openAIModel,
				currentProvider(),
				"system"
			);

			await expect(makeRequest("prompt")).rejects.toThrow(
				"Online features are disabled in settings."
			);
			expect(requestUrlMock).not.toHaveBeenCalled();
			expect(beginAIRequestLogEntryMock).not.toHaveBeenCalled();
		});

		it("sends requests even when the local estimate exceeds the configured token limit", async () => {
			const model: Model = { name: "gpt-4o", maxTokens: 1 };
			getModelProviderMock.mockReturnValue(openAIProvider);
			requestUrlMock.mockResolvedValue({ json: openAIResponse() });
			const makeRequest = OpenAIRequest(makeApp(), "key", model, currentProvider(), "system");

			await expect(makeRequest("prompt")).resolves.toBeDefined();
			expect(requestUrlMock).toHaveBeenCalledTimes(1);
			expect(mocks.logMessageMock).toHaveBeenCalledWith(
				expect.stringContaining("Estimated prompt size")
			);
		});

		it("does not log an estimate warning when the estimate is within the configured limit", async () => {
			const model: Model = { name: "gpt-4o", maxTokens: 100000 };
			getModelProviderMock.mockReturnValue(openAIProvider);
			requestUrlMock.mockResolvedValue({ json: openAIResponse() });

			const makeRequest = OpenAIRequest(makeApp(), "key", model, currentProvider(), "system");
			await expect(makeRequest("prompt")).resolves.toBeDefined();
			expect(requestUrlMock).toHaveBeenCalledTimes(1);
			expect(mocks.logMessageMock).not.toHaveBeenCalledWith(
				expect.stringContaining("Estimated prompt size")
			);
		});
	});

	describe("provider error body capture", () => {
		beforeEach(() => {
			getModelProviderMock.mockReturnValue(openAIProvider);
		});

		it("surfaces a 4xx provider body so the error is classifiable as a context limit", async () => {
			requestUrlMock.mockResolvedValue({
				status: 400,
				json: {
					error: {
						code: "context_length_exceeded",
						message: "maximum context length exceeded",
					},
				},
				text: '{"error":{"code":"context_length_exceeded"}}',
			});
			const makeRequest = OpenAIRequest(makeApp(), "key", openAIModel, currentProvider(), "sys");

			let thrown: unknown;
			try {
				await makeRequest("prompt");
			} catch (error) {
				thrown = error;
			}

			expect(thrown).toBeInstanceOf(Error);
			expect(String((thrown as Error).message)).toMatch(
				/context_length_exceeded|maximum context length/i
			);
			// The real provider body now reaches the classifier (it did not before).
			expect(isLikelyContextLimitError(thrown)).toBe(true);
			expect(((thrown as Error).cause as { status?: number }).status).toBe(400);
		});

		it("does not classify a non-context 4xx (auth) as a context-limit error", async () => {
			requestUrlMock.mockResolvedValue({
				status: 401,
				json: {
					error: {
						code: "invalid_api_key",
						message: "Incorrect API key provided",
					},
				},
			});
			const makeRequest = OpenAIRequest(makeApp(), "key", openAIModel, currentProvider(), "sys");

			let thrown: unknown;
			await expect(makeRequest("prompt")).rejects.toThrow(
				/Incorrect API key|invalid_api_key/i
			);
			try {
				await makeRequest("prompt");
			} catch (error) {
				thrown = error;
			}
			expect(isLikelyContextLimitError(thrown)).toBe(false);
		});

		it("treats a 4xx whose completion alone exceeds context as output-budget (no retry)", async () => {
			requestUrlMock.mockResolvedValue({
				status: 400,
				json: {
					error: {
						code: "context_length_exceeded",
						message:
							"maximum context length is 8192 tokens; you requested 9500 (500 in the messages, 9000 in the completion)",
					},
				},
			});
			const makeRequest = OpenAIRequest(makeApp(), "key", openAIModel, currentProvider(), "sys");

			let thrown: unknown;
			try {
				await makeRequest("prompt");
			} catch (error) {
				thrown = error;
			}
			expect(classifyProviderError(thrown)).toBe("output_budget");
			expect(isLikelyContextLimitError(thrown)).toBe(false);
		});
	});

	describe("OpenAI request construction", () => {
		beforeEach(() => {
			getModelProviderMock.mockReturnValue(openAIProvider);
			requestUrlMock.mockResolvedValue({ json: openAIResponse() });
		});

		it("posts to the chat/completions endpoint with auth header and JSON content type", async () => {
			const makeRequest = OpenAIRequest(
				makeApp(),
				"secret-key",
				openAIModel,
				currentProvider(),
				"system"
			);
			await makeRequest("prompt");

			expect(requestUrlMock).toHaveBeenCalledTimes(1);
			const arg = requestUrlMock.mock.calls[0][0];
			expect(arg.url).toBe("https://api.openai.com/v1/chat/completions");
			expect(arg.method).toBe("POST");
			expect(arg.headers).toEqual({
				"Content-Type": "application/json",
				Authorization: "Bearer secret-key",
			});
		});

		it("serializes model name, model params, and system/user messages into the body", async () => {
			const params = { temperature: 0.5, top_p: 0.9 };
			const makeRequest = OpenAIRequest(
				makeApp(),
				"key",
				openAIModel, currentProvider(),
				"you are helpful",
				params
			);
			await makeRequest("what is 2+2?");

			const body = JSON.parse(requestUrlMock.mock.calls[0][0].body);
			expect(body).toEqual({
				model: "gpt-4o",
				temperature: 0.5,
				top_p: 0.9,
				messages: [
					{ role: "system", content: "you are helpful" },
					{ role: "user", content: "what is 2+2?" },
				],
			});
		});

		it("omits extra params when modelParams defaults to empty", async () => {
			const makeRequest = OpenAIRequest(
				makeApp(),
				"key",
				openAIModel, currentProvider(),
				"sys"
			);
			await makeRequest("hi");

			const body = JSON.parse(requestUrlMock.mock.calls[0][0].body);
			expect(Object.keys(body)).toEqual(["model", "messages"]);
		});

		it("maps the OpenAI response into the common response shape", async () => {
			const makeRequest = OpenAIRequest(
				makeApp(),
				"key",
				openAIModel, currentProvider(),
				"sys"
			);
			const result = await makeRequest("hi");

			expect(result).toEqual({
				id: "chatcmpl-123",
				model: "gpt-4o",
				content: "Hello there",
				usage: {
					promptTokens: 10,
					completionTokens: 20,
					totalTokens: 30,
				},
				stopReason: "stop",
				stopSequence: null,
				created: 1700000000,
			});
		});
	});

	describe("Anthropic request construction", () => {
		beforeEach(() => {
			getModelProviderMock.mockReturnValue(anthropicProvider);
		});

		it("posts to /v1/messages with a top-level system prompt, model-aware max_tokens, and no stale beta header", async () => {
			requestUrlMock.mockResolvedValue({
				json: {
					id: "msg-1",
					model: "claude-3-5-sonnet",
					role: "assistant",
					stop_reason: "end_turn",
					stop_sequence: null,
					type: "message",
					content: [{ text: "Hi from Claude", type: "text" }],
					usage: { input_tokens: 5, output_tokens: 8 },
				},
			});

			const makeRequest = OpenAIRequest(
				makeApp(),
				"anthropic-key",
				anthropicModel, currentProvider(),
				"system prompt"
			);
			await makeRequest("hello claude");

			const arg = requestUrlMock.mock.calls[0][0];
			expect(arg.url).toBe("https://api.anthropic.com/v1/messages");
			// Stale anthropic-beta header dropped.
			expect(arg.headers).toEqual({
				"Content-Type": "application/json",
				"x-api-key": "anthropic-key",
				"anthropic-version": "2023-06-01",
			});

			const body = JSON.parse(arg.body);
			expect(body).toEqual({
				model: "claude-3-5-sonnet",
				// Conservative 4096 default (at/below every current Claude model's output cap).
				max_tokens: 4096,
				messages: [{ role: "user", content: "hello claude" }],
				system: "system prompt",
			});
		});

		it("omits the system key when no system prompt is given", async () => {
			requestUrlMock.mockResolvedValue({
				json: {
					id: "msg-1b",
					model: "claude-3-5-sonnet",
					role: "assistant",
					stop_reason: "end_turn",
					stop_sequence: null,
					type: "message",
					content: [{ text: "ok", type: "text" }],
					usage: { input_tokens: 1, output_tokens: 1 },
				},
			});

			const makeRequest = OpenAIRequest(makeApp(), "anthropic-key", anthropicModel, currentProvider(), "");
			await makeRequest("hi");

			const body = JSON.parse(requestUrlMock.mock.calls[0][0].body);
			expect("system" in body).toBe(false);
			expect(body.max_tokens).toBe(4096);
		});

		it("omits the system key for a whitespace-only system prompt", async () => {
			requestUrlMock.mockResolvedValue({
				json: {
					id: "msg-1c",
					model: "claude-3-5-sonnet",
					role: "assistant",
					stop_reason: "end_turn",
					stop_sequence: null,
					type: "message",
					content: [{ text: "ok", type: "text" }],
					usage: { input_tokens: 1, output_tokens: 1 },
				},
			});

			const makeRequest = OpenAIRequest(makeApp(), "anthropic-key", anthropicModel, currentProvider(), "   ");
			await makeRequest("hi");

			const body = JSON.parse(requestUrlMock.mock.calls[0][0].body);
			expect("system" in body).toBe(false);
		});

		it("extracts text by scanning all content blocks (a leading tool_use block does not break it)", async () => {
			requestUrlMock.mockResolvedValue({
				json: {
					id: "msg-3",
					model: "claude-3-5-sonnet",
					role: "assistant",
					stop_reason: "tool_use",
					stop_sequence: null,
					type: "message",
					content: [
						{ type: "tool_use", id: "toolu_1", name: "x", input: {} },
						{ type: "text", text: "after the tool block" },
					],
					usage: { input_tokens: 3, output_tokens: 2 },
				},
			});

			const makeRequest = OpenAIRequest(makeApp(), "anthropic-key", anthropicModel, currentProvider(), "sys");
			const result = await makeRequest("q");

			expect(result.content).toBe("after the tool block");
		});

		it("maps the Anthropic response, summing tokens and preserving stop_sequence", async () => {
			requestUrlMock.mockResolvedValue({
				json: {
					id: "msg-2",
					model: "claude-3-5-sonnet",
					role: "assistant",
					stop_reason: "stop_sequence",
					stop_sequence: "###",
					type: "message",
					content: [{ text: "Answer", type: "text" }],
					usage: { input_tokens: 11, output_tokens: 4 },
				},
			});

			const makeRequest = OpenAIRequest(
				makeApp(),
				"key",
				anthropicModel, currentProvider(),
				"sys"
			);
			const result = await makeRequest("q");

			expect(result.id).toBe("msg-2");
			expect(result.content).toBe("Answer");
			expect(result.usage).toEqual({
				promptTokens: 11,
				completionTokens: 4,
				totalTokens: 15,
			});
			expect(result.stopReason).toBe("stop_sequence");
			expect(result.stopSequence).toBe("###");
			expect(typeof result.created).toBe("number");
		});
	});

	describe("Gemini request construction", () => {
		beforeEach(() => {
			getModelProviderMock.mockReturnValue(geminiProvider);
		});

		it("uses the generateContent URL with the api key as a header, never in the URL", async () => {
			requestUrlMock.mockResolvedValue({
				json: {
					candidates: [
						{
							content: {
								role: "model",
								parts: [{ text: "Gemini reply" }],
							},
							finishReason: "STOP",
						},
					],
					modelVersion: "gemini-1.5-pro-001",
					usageMetadata: {
						promptTokenCount: 7,
						candidatesTokenCount: 9,
						totalTokenCount: 16,
					},
				},
			});

			const makeRequest = OpenAIRequest(
				makeApp(),
				"gem ini/key",
				geminiModel, currentProvider(),
				"system instruction text"
			);
			await makeRequest("hi gemini");

			const arg = requestUrlMock.mock.calls[0][0];
			// The key must never appear in the URL — URLs land in logs and proxies.
			expect(arg.url).toBe(
				"https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-pro:generateContent"
			);
			// Gemini does not use the Authorization header; the key travels as
			// x-goog-api-key (verified live).
			expect(arg.headers).toEqual({
				"Content-Type": "application/json",
				"x-goog-api-key": "gem ini/key",
			});
		});

		it("includes a systemInstruction when a non-empty system prompt is provided", async () => {
			requestUrlMock.mockResolvedValue({
				json: { candidates: [{ content: { role: "model", parts: [] } }] },
			});

			const makeRequest = OpenAIRequest(
				makeApp(),
				"key",
				geminiModel, currentProvider(),
				"  you are helpful  "
			);
			await makeRequest("hi");

			const body = JSON.parse(requestUrlMock.mock.calls[0][0].body);
			expect(body.systemInstruction).toEqual({
				role: "system",
				parts: [{ text: "  you are helpful  " }],
			});
			expect(body.contents).toEqual([
				{ role: "user", parts: [{ text: "hi" }] },
			]);
		});

		it("omits systemInstruction when the system prompt is empty/whitespace", async () => {
			requestUrlMock.mockResolvedValue({
				json: { candidates: [{ content: { role: "model", parts: [] } }] },
			});

			const makeRequest = OpenAIRequest(makeApp(), "key", geminiModel, currentProvider(), "   ");
			await makeRequest("hi");

			const body = JSON.parse(requestUrlMock.mock.calls[0][0].body);
			expect(body.systemInstruction).toBeUndefined();
		});

		it("maps only temperature and top_p into generationConfig", async () => {
			requestUrlMock.mockResolvedValue({
				json: { candidates: [{ content: { role: "model", parts: [] } }] },
			});

			const makeRequest = OpenAIRequest(
				makeApp(),
				"key",
				geminiModel, currentProvider(),
				"sys",
				{
					temperature: 0.3,
					top_p: 0.8,
					frequency_penalty: 0.5,
					presence_penalty: 0.5,
				}
			);
			await makeRequest("hi");

			const body = JSON.parse(requestUrlMock.mock.calls[0][0].body);
			expect(body.generationConfig).toEqual({
				temperature: 0.3,
				topP: 0.8,
			});
		});

		it("omits generationConfig when no supported params are provided", async () => {
			requestUrlMock.mockResolvedValue({
				json: { candidates: [{ content: { role: "model", parts: [] } }] },
			});

			const makeRequest = OpenAIRequest(makeApp(), "key", geminiModel, currentProvider(), "sys", {
				frequency_penalty: 0.5,
			});
			await makeRequest("hi");

			const body = JSON.parse(requestUrlMock.mock.calls[0][0].body);
			expect(body.generationConfig).toBeUndefined();
		});

		it("concatenates multiple text parts and reads usage metadata", async () => {
			requestUrlMock.mockResolvedValue({
				json: {
					candidates: [
						{
							content: {
								role: "model",
								parts: [
									{ text: "Hello " },
									{ inlineData: {} },
									{ text: "world" },
								],
							},
							finishReason: "STOP",
						},
					],
					modelVersion: "gemini-x",
					usageMetadata: {
						promptTokenCount: 2,
						candidatesTokenCount: 3,
						totalTokenCount: 5,
					},
				},
			});

			const makeRequest = OpenAIRequest(makeApp(), "key", geminiModel, currentProvider(), "sys");
			const result = await makeRequest("hi");

			expect(result.content).toBe("Hello world");
			expect(result.model).toBe("gemini-x");
			expect(result.usage).toEqual({
				promptTokens: 2,
				completionTokens: 3,
				totalTokens: 5,
			});
			expect(result.stopReason).toBe("STOP");
		});

		it("defaults usage and stopReason when metadata is missing", async () => {
			requestUrlMock.mockResolvedValue({
				json: { candidates: [{ content: { role: "model", parts: [] } }] },
			});

			const makeRequest = OpenAIRequest(makeApp(), "key", geminiModel, currentProvider(), "sys");
			const result = await makeRequest("hi");

			expect(result.content).toBe("");
			expect(result.model).toBe("gemini");
			expect(result.usage).toEqual({
				promptTokens: 0,
				completionTokens: 0,
				totalTokens: 0,
			});
			expect(result.stopReason).toBe("");
		});
	});

	describe("logging lifecycle", () => {
		it("logs a pending entry then a success entry with usage and duration", async () => {
			getModelProviderMock.mockReturnValue(openAIProvider);
			requestUrlMock.mockResolvedValue({ json: openAIResponse() });

			const makeRequest = OpenAIRequest(
				makeApp(),
				"key",
				openAIModel, currentProvider(),
				"sys",
				{ temperature: 0.2 }
			);
			await makeRequest("prompt");

			expect(beginAIRequestLogEntryMock).toHaveBeenCalledWith({
				provider: "OpenAI",
				endpoint: "https://api.openai.com/v1",
				model: "gpt-4o",
				systemPrompt: "sys",
				prompt: "prompt",
				modelOptions: { temperature: 0.2 },
			});

			expect(finishAIRequestLogEntryMock).toHaveBeenCalledTimes(1);
			const [id, result] = finishAIRequestLogEntryMock.mock.calls[0];
			expect(id).toBe("log-id-1");
			expect(result.status).toBe("success");
			expect(typeof result.durationMs).toBe("number");
			expect(result.durationMs).toBeGreaterThanOrEqual(0);
			expect(result.usage).toEqual({
				promptTokens: 10,
				completionTokens: 20,
				totalTokens: 30,
			});
		});

		it("logs an error entry and rethrows a wrapped error when requestUrl rejects", async () => {
			getModelProviderMock.mockReturnValue(openAIProvider);
			const networkError = new Error("Network down");
			requestUrlMock.mockRejectedValue(networkError);

			const makeRequest = OpenAIRequest(
				makeApp(),
				"key",
				openAIModel, currentProvider(),
				"sys"
			);

			await expect(makeRequest("prompt")).rejects.toThrow(
				"Error while making request to OpenAI: Network down"
			);

			expect(finishAIRequestLogEntryMock).toHaveBeenCalledTimes(1);
			const [, result] = finishAIRequestLogEntryMock.mock.calls[0];
			expect(result.status).toBe("error");
			expect(result.errorMessage).toBe("Network down");
			expect(logErrorMock).toHaveBeenCalledWith(networkError);
		});

		it("preserves the original error as the cause of the wrapped error", async () => {
			getModelProviderMock.mockReturnValue(openAIProvider);
			const networkError = new Error("boom");
			requestUrlMock.mockRejectedValue(networkError);

			const makeRequest = OpenAIRequest(makeApp(), "key", openAIModel, currentProvider(), "sys");

			await expect(makeRequest("prompt")).rejects.toMatchObject({
				cause: networkError,
			});
		});

		it("stringifies non-Error rejections in the error message", async () => {
			getModelProviderMock.mockReturnValue(openAIProvider);
			requestUrlMock.mockRejectedValue("plain string failure");

			const makeRequest = OpenAIRequest(makeApp(), "key", openAIModel, currentProvider(), "sys");

			await expect(makeRequest("prompt")).rejects.toThrow(
				"Error while making request to OpenAI: plain string failure"
			);
		});
	});

	describe("cursor restoration", () => {
		it("restores the cursor and selection after dispatching the request", async () => {
			getModelProviderMock.mockReturnValue(openAIProvider);
			requestUrlMock.mockResolvedValue({ json: openAIResponse() });

			const { app, calls, cursor, selections } = makeAppWithEditor();
			const makeRequest = OpenAIRequest(app, "key", openAIModel, currentProvider(), "sys");
			await makeRequest("prompt");

			expect(calls.setCursor).toHaveBeenCalledWith(cursor);
			expect(calls.setSelections).toHaveBeenCalledWith(selections);
		});
	});
});
