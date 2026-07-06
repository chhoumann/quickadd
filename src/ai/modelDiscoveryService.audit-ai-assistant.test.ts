import { beforeEach, describe, expect, it, vi } from "vitest";

const storeState = vi.hoisted(() => ({
	disableOnlineFeatures: false,
	ai: { providers: [] as unknown[] },
}));

const mocks = vi.hoisted(() => ({
	requestUrlMock: vi.fn(),
	fetchModelsDevDirectoryMock: vi.fn(),
	mapEndpointToModelsDevKeyMock: vi.fn(),
	mapModelsDevToQuickAddMock: vi.fn(),
	// Pass-through: enrichment has its own unit tests.
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
	},
}));

const { discoverProviderModels } = await import("./modelDiscoveryService");

// Finding: ai-assistant-model-discovery-service — the /v1/models discovery path
// previously used requestUrl with the default throw, so a 4xx (e.g. 401 bad key)
// surfaced only Obsidian's bare "Request failed, status N" and the provider's
// real code/message was never read. It must now read the body via throw:false and
// build a structured provider error.
describe("modelDiscoveryService structured provider errors", () => {
	beforeEach(() => {
		mocks.requestUrlMock.mockReset();
		mocks.fetchModelsDevDirectoryMock.mockReset();
		mocks.mapEndpointToModelsDevKeyMock.mockReset();
		mocks.mapModelsDevToQuickAddMock.mockReset();
		storeState.disableOnlineFeatures = false;
	});

	it("requests with throw:false and surfaces the provider's real error detail on 4xx", async () => {
		mocks.requestUrlMock.mockResolvedValue({
			status: 401,
			json: {
				error: { message: "invalid api key", code: "invalid_api_key" },
			},
		});

		await expect(
			discoverProviderModels({
				name: "OpenAI",
				endpoint: "https://api.openai.com/v1",
				apiKey: "bad-key",
				models: [],
				autoSyncModels: false,
				modelSource: "providerApi",
			}),
		).rejects.toThrow(/invalid api key/);

		// throw:false is required so we can read the body instead of letting
		// requestUrl reject with a body-less "Request failed, status N".
		expect(mocks.requestUrlMock).toHaveBeenCalledWith(
			expect.objectContaining({ throw: false }),
		);
	});

	it("still parses successful list responses (no regression)", async () => {
		mocks.requestUrlMock.mockResolvedValue({
			json: Promise.resolve([{ id: "gpt-4o", max_tokens: 100000 }]),
		});

		const models = await discoverProviderModels({
			name: "Custom",
			endpoint: "https://api.custom.ai",
			apiKey: "ok",
			models: [],
			autoSyncModels: false,
			modelSource: "providerApi",
		});

		expect(models).toEqual([{ name: "gpt-4o", maxTokens: 100000 }]);
	});
});
