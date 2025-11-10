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
}));

vi.mock("obsidian", () => ({
	requestUrl: mocks.requestUrlMock,
}));

vi.mock("./modelsDirectory", () => ({
	fetchModelsDevDirectory: mocks.fetchModelsDevDirectoryMock,
	mapEndpointToModelsDevKey: mocks.mapEndpointToModelsDevKeyMock,
	mapModelsDevToQuickAdd: mocks.mapModelsDevToQuickAddMock,
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
