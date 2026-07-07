import { beforeEach, describe, expect, it, vi } from "vitest";

const storeState = vi.hoisted(() => ({
	disableOnlineFeatures: false,
	ai: { providers: [] },
}));

const mocks = vi.hoisted(() => ({
	requestUrlMock: vi.fn(),
	fetchModelsDevDirectoryMock: vi.fn(),
	mapEndpointToModelsDevKeyMock: vi.fn(),
	mapModelsDevToQuickAddMock: vi.fn(),
	// Pass-through by default: enrichment is exercised by its own unit tests.
	enrichModelsWithDirectoryMetadataMock: vi.fn(
		async (_endpoint: string, models: unknown[]) => models,
	),
}));

vi.mock("obsidian", () => ({
	requestUrl: mocks.requestUrlMock,
}));

vi.mock("./modelsDirectory", () => ({
	fetchModelsDevDirectory: mocks.fetchModelsDevDirectoryMock,
	mapEndpointToModelsDevKey: mocks.mapEndpointToModelsDevKeyMock,
	mapModelsDevToQuickAdd: mocks.mapModelsDevToQuickAddMock,
	enrichModelsWithDirectoryMetadata: mocks.enrichModelsWithDirectoryMetadataMock,
}));

vi.mock("src/settingsStore", () => ({
	settingsStore: {
		getState: () => storeState,
		setState: (update: any) => {
			const next = typeof update === "function" ? update(storeState) : update;
			Object.assign(storeState, next);
			return storeState;
		},
	},
}));


const requestUrlMock = mocks.requestUrlMock;
const fetchModelsDevDirectoryMock = mocks.fetchModelsDevDirectoryMock;
const mapEndpointToModelsDevKeyMock = mocks.mapEndpointToModelsDevKeyMock;
const mapModelsDevToQuickAddMock = mocks.mapModelsDevToQuickAddMock;

const { discoverProviderModels } = await import("./modelDiscoveryService");

describe("modelDiscoveryService", () => {
beforeEach(() => {
	requestUrlMock.mockReset();
	fetchModelsDevDirectoryMock.mockReset();
	mapEndpointToModelsDevKeyMock.mockReset();
	mapModelsDevToQuickAddMock.mockReset();
	storeState.disableOnlineFeatures = false;
	storeState.ai = { providers: [] };
});

	it("parses provider /v1/models list responses", async () => {
		requestUrlMock.mockResolvedValue({
			json: Promise.resolve({
				data: [
					{ id: "gpt-4o", max_tokens: 100000 },
					{ name: "backup-model", context_length: "2048" },
				],
			}),
		});

		const models = await discoverProviderModels({
			name: "Custom",
			endpoint: "https://api.custom.ai",
			apiKey: "test",
			models: [],
			autoSyncModels: false,
			modelSource: "providerApi",
		});

		expect(models).toEqual([
			{ name: "gpt-4o", maxTokens: 100000 },
			{ name: "backup-model", maxTokens: 2048 },
		]);

		expect(requestUrlMock).toHaveBeenCalledWith(
			expect.objectContaining({ url: "https://api.custom.ai/v1/models" }),
		);
	});

	it("uses default maxTokens when provider omits limits", async () => {
		requestUrlMock.mockResolvedValue({
			json: Promise.resolve([
				{ name: "mystery-model" },
			]),
		});

		const models = await discoverProviderModels({
			name: "ArrayProvider",
			endpoint: "https://api.array.ai/v1/",
			apiKey: "key",
			models: [],
			autoSyncModels: false,
			modelSource: "providerApi",
		});

		expect(models).toEqual([
			{ name: "mystery-model", maxTokens: 128000 },
		]);

		// ensure trailing slash stripped but existing /v1 preserved
		expect(requestUrlMock).toHaveBeenCalledWith(
			expect.objectContaining({ url: "https://api.array.ai/v1/models" }),
		);
	});

	it("handles endpoints already ending with /v1", async () => {
		requestUrlMock.mockResolvedValue({
			json: Promise.resolve([
				{ id: "model" },
			]),
		});

		await discoverProviderModels({
			name: "Router",
			endpoint: "https://openrouter.ai/api/v1",
			apiKey: "key",
			models: [],
			autoSyncModels: false,
			modelSource: "providerApi",
		});

		expect(requestUrlMock).toHaveBeenCalledWith(
			expect.objectContaining({ url: "https://openrouter.ai/api/v1/models" }),
		);
	});

	it("allows providers without API keys", async () => {
		requestUrlMock.mockResolvedValue({
			json: Promise.resolve([
				{ id: "public" },
			]),
		});

		await discoverProviderModels({
			name: "Public",
			endpoint: "http://localhost:11434/v1",
			apiKey: "",
			models: [],
			autoSyncModels: false,
			modelSource: "providerApi",
		});

		expect(requestUrlMock).toHaveBeenCalledWith(
			expect.objectContaining({ headers: {} }),
		);
	});

	it("falls back to models.dev in auto mode when provider request fails", async () => {
		requestUrlMock.mockRejectedValue(new Error("401"));
		mapEndpointToModelsDevKeyMock.mockReturnValue("openai");
		fetchModelsDevDirectoryMock.mockResolvedValue({
			openai: {
				id: "openai",
				name: "OpenAI",
				models: {
					gpt4o: { id: "gpt-4o", limit: { context: 128000 } },
				},
			},
		});
		mapModelsDevToQuickAddMock.mockReturnValue([
			{ name: "gpt-4o", maxTokens: 128000 },
		]);

		const models = await discoverProviderModels({
			name: "OpenAI",
			endpoint: "https://api.openai.com/v1",
			apiKey: "key",
			models: [],
			autoSyncModels: false,
			modelSource: "auto",
		});

		expect(models).toEqual([{ name: "gpt-4o", maxTokens: 128000 }]);
		expect(fetchModelsDevDirectoryMock).toHaveBeenCalled();
	});

	it("throws when auto mode cannot map endpoint and provider fails", async () => {
		const error = new Error("timeout");
		requestUrlMock.mockRejectedValue(error);
		mapEndpointToModelsDevKeyMock.mockReturnValue(null);

		await expect(
			discoverProviderModels({
				name: "Unknown",
				endpoint: "https://example.com/api",
				apiKey: "key",
				models: [],
				autoSyncModels: false,
				modelSource: "auto",
			}),
		).rejects.toThrow("timeout");
	});

	it("uses models.dev directly when modelSource is modelsDev", async () => {
		fetchModelsDevDirectoryMock.mockResolvedValue({
			openrouter: {
				id: "openrouter",
				name: "OpenRouter",
				models: {
					one: { id: "model-1", limit: { context: 42 } },
				},
			},
		});
		mapEndpointToModelsDevKeyMock.mockReturnValue("openrouter");
		mapModelsDevToQuickAddMock.mockReturnValue([
			{ name: "model-1", maxTokens: 42 },
		]);

		const models = await discoverProviderModels({
			name: "OpenRouter",
			endpoint: "https://openrouter.ai/api/v1",
			apiKey: "optional",
			models: [],
			autoSyncModels: false,
			modelSource: "modelsDev",
		});

		expect(models).toEqual([{ name: "model-1", maxTokens: 42 }]);
		expect(requestUrlMock).not.toHaveBeenCalled();
	});

	it("uses x-api-key + anthropic-version for Anthropic providers (Bearer is a 401)", async () => {
		requestUrlMock.mockResolvedValue({
			status: 200,
			json: Promise.resolve({
				data: [{ id: "claude-sonnet-5", type: "model" }],
				has_more: false,
			}),
		});

		const models = await discoverProviderModels({
			name: "Anthropic",
			endpoint: "https://api.anthropic.com",
			kind: "anthropic",
			apiKey: "sk-ant-test",
			models: [],
			autoSyncModels: false,
			modelSource: "providerApi",
		});

		expect(models.map((m) => m.name)).toEqual(["claude-sonnet-5"]);
		expect(requestUrlMock).toHaveBeenCalledWith(
			expect.objectContaining({
				url: "https://api.anthropic.com/v1/models?limit=1000",
				headers: expect.objectContaining({
					"x-api-key": "sk-ant-test",
					"anthropic-version": expect.any(String),
				}),
			}),
		);
		const headers = requestUrlMock.mock.calls[0][0].headers;
		expect(headers.Authorization).toBeUndefined();
	});

	it("follows Anthropic pagination via has_more/last_id", async () => {
		requestUrlMock
			.mockResolvedValueOnce({
				status: 200,
				json: Promise.resolve({
					data: [{ id: "claude-a" }],
					has_more: true,
					last_id: "claude-a",
				}),
			})
			.mockResolvedValueOnce({
				status: 200,
				json: Promise.resolve({
					data: [{ id: "claude-b" }],
					has_more: false,
				}),
			});

		const models = await discoverProviderModels({
			name: "Anthropic",
			endpoint: "https://api.anthropic.com",
			kind: "anthropic",
			apiKey: "k",
			models: [],
			autoSyncModels: false,
			modelSource: "providerApi",
		});

		expect(models.map((m) => m.name)).toEqual(["claude-a", "claude-b"]);
		expect(requestUrlMock).toHaveBeenCalledTimes(2);
		expect(requestUrlMock.mock.calls[1][0].url).toContain(
			"after_id=claude-a",
		);
	});

	it("uses the Gemini ListModels endpoint with key param and filters non-chat models", async () => {
		// The seed-metadata fallback keys off the directory mapping.
		mapEndpointToModelsDevKeyMock.mockReturnValue("google");
		requestUrlMock.mockResolvedValue({
			status: 200,
			json: Promise.resolve({
				models: [
					{
						name: "models/gemini-2.5-flash",
						inputTokenLimit: 1048576,
						outputTokenLimit: 65536,
						supportedGenerationMethods: ["generateContent", "countTokens"],
					},
					{
						name: "models/gemini-embedding-001",
						inputTokenLimit: 2048,
						supportedGenerationMethods: ["embedContent"],
					},
				],
			}),
		});

		const models = await discoverProviderModels({
			name: "Gemini",
			endpoint: "https://generativelanguage.googleapis.com",
			kind: "gemini",
			apiKey: "g-key",
			models: [],
			autoSyncModels: false,
			modelSource: "providerApi",
		});

		expect(models).toEqual([
			{
				name: "gemini-2.5-flash",
				maxTokens: 1048576,
				maxOutputTokens: 65536,
				// Filled from the shipped seed catalog (models.dev enrichment is
				// mocked out here).
				supportsTemperature: true,
			},
		]);
		// The key travels as a header, never in the URL (it would leak into logs).
		expect(requestUrlMock.mock.calls[0][0].url).toBe(
			"https://generativelanguage.googleapis.com/v1beta/models?pageSize=1000",
		);
		expect(requestUrlMock.mock.calls[0][0].headers).toEqual({
			"x-goog-api-key": "g-key",
		});
	});

	it("fills missing metadata from the seed catalog when the directory is unavailable", async () => {
		mapEndpointToModelsDevKeyMock.mockReturnValue("anthropic");
		requestUrlMock.mockResolvedValue({
			status: 200,
			json: Promise.resolve({
				data: [
					{ id: "claude-sonnet-5", type: "model" },
					{ id: "claude-unknown-model", type: "model" },
				],
				has_more: false,
			}),
		});

		const models = await discoverProviderModels({
			name: "Anthropic",
			endpoint: "https://api.anthropic.com",
			kind: "anthropic",
			apiKey: "k",
			models: [],
			autoSyncModels: false,
			modelSource: "providerApi",
		});

		const sonnet = models.find((m) => m.name === "claude-sonnet-5")!;
		expect(sonnet.maxTokens).toBe(1_000_000);
		expect(sonnet.maxOutputTokens).toBe(128_000);
		expect(sonnet.supportsTemperature).toBe(false);
		// Unknown ids keep the conservative placeholder.
		const unknown = models.find((m) => m.name === "claude-unknown-model")!;
		expect(unknown.maxTokens).toBe(128_000);
		expect(unknown.maxOutputTokens).toBeUndefined();
	});

	it("filters non-chat entries from OpenAI-compatible model lists", async () => {
		requestUrlMock.mockResolvedValue({
			status: 200,
			json: Promise.resolve({
				data: [
					{ id: "llama-3.3-70b-versatile" },
					{ id: "whisper-large-v3" },
					{ id: "playai-tts" },
					{ id: "text-embedding-3-small" },
					{ id: "gpt-image-2" },
				],
			}),
		});

		const models = await discoverProviderModels({
			name: "Groq",
			endpoint: "https://api.groq.com/openai/v1",
			apiKey: "k",
			models: [],
			autoSyncModels: false,
			modelSource: "providerApi",
		});

		expect(models.map((m) => m.name)).toEqual(["llama-3.3-70b-versatile"]);
	});

	it("respects disableOnlineFeatures by throwing early", async () => {
		storeState.disableOnlineFeatures = true;
		await expect(
			discoverProviderModels({
				name: "Router",
				endpoint: "https://openrouter.ai/api/v1",
				apiKey: "key",
				models: [],
				autoSyncModels: false,
				modelSource: "providerApi",
			}),
		).rejects.toThrow("Online features are disabled");
		expect(requestUrlMock).not.toHaveBeenCalled();
	});
});
