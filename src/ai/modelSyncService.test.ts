import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AIProvider } from "./Provider";

const storeState = vi.hoisted(() => ({
	disableOnlineFeatures: false,
	ai: {
		providers: [] as unknown[],
		lastModelAutoSyncAt: undefined as number | undefined,
	},
}));

const mocks = vi.hoisted(() => ({
	discoverProviderModelsMock: vi.fn(),
	resolveProviderApiKeyMock: vi.fn(async () => "key"),
	logMessageMock: vi.fn(),
}));

vi.mock("obsidian", () => ({}));

vi.mock("src/settingsStore", () => ({
	settingsStore: {
		getState: () => storeState,
		setState: (update: unknown) => {
			const next =
				typeof update === "function"
					? (update as (s: unknown) => unknown)(storeState)
					: update;
			Object.assign(storeState, next);
			return storeState;
		},
	},
}));

vi.mock("./modelDiscoveryService", () => ({
	discoverProviderModels: mocks.discoverProviderModelsMock,
}));

vi.mock("./providerSecrets", () => ({
	resolveProviderApiKey: mocks.resolveProviderApiKeyMock,
}));

vi.mock("src/logger/logManager", () => ({
	log: { logMessage: mocks.logMessageMock, logError: vi.fn() },
}));

const { autoSyncEnabledProviders, syncProviderModels } = await import(
	"./modelSyncService"
);

function makeProvider(overrides: Partial<AIProvider> = {}): AIProvider {
	return {
		name: "OpenAI",
		endpoint: "https://api.openai.com/v1",
		apiKey: "",
		models: [{ name: "gpt-4o", maxTokens: 4096 }],
		autoSyncModels: true,
		modelSource: "modelsDev",
		...overrides,
	};
}

describe("syncProviderModels", () => {
	beforeEach(() => {
		mocks.discoverProviderModelsMock.mockReset();
	});

	it("reports added and metadata-updated counts", async () => {
		mocks.discoverProviderModelsMock.mockResolvedValue([
			{ name: "gpt-4o", maxTokens: 128000, maxOutputTokens: 16384 },
			{ name: "gpt-5.5", maxTokens: 1050000 },
		]);
		const provider = makeProvider();

		const result = await syncProviderModels(undefined, provider);

		expect(result).toEqual({ added: 1, updated: 1 });
		expect(provider.models.map((m) => m.name)).toEqual([
			"gpt-4o",
			"gpt-5.5",
		]);
		expect(provider.models[0].maxTokens).toBe(128000);
	});
});

describe("autoSyncEnabledProviders", () => {
	beforeEach(() => {
		mocks.discoverProviderModelsMock.mockReset();
		storeState.disableOnlineFeatures = false;
		storeState.ai.lastModelAutoSyncAt = undefined;
		storeState.ai.providers = [makeProvider()];
	});

	it("merges results into the CURRENT state, preserving edits made during the sync", async () => {
		// While discovery is in flight, the user renames a model list entry and
		// adds a second provider. Neither edit may be lost.
		mocks.discoverProviderModelsMock.mockImplementation(async () => {
			storeState.ai.providers = [
				{
					...makeProvider(),
					models: [
						{ name: "gpt-4o", maxTokens: 4096 },
						{ name: "user-added", maxTokens: 1234 },
					],
				},
				makeProvider({ name: "Custom", endpoint: "http://x", autoSyncModels: false }),
			];
			return [{ name: "gpt-5.5", maxTokens: 1050000 }];
		});

		await autoSyncEnabledProviders(undefined);

		const providers = storeState.ai.providers as AIProvider[];
		expect(providers).toHaveLength(2);
		const openai = providers[0];
		expect(openai.models.map((m) => m.name)).toEqual([
			"gpt-4o",
			"user-added",
			"gpt-5.5",
		]);
	});

	it("drops results for providers the user removed mid-sync", async () => {
		mocks.discoverProviderModelsMock.mockImplementation(async () => {
			storeState.ai.providers = [];
			return [{ name: "gpt-5.5", maxTokens: 1050000 }];
		});

		await autoSyncEnabledProviders(undefined);

		expect(storeState.ai.providers).toEqual([]);
	});

	it("advances the daily throttle only when at least one provider synced", async () => {
		mocks.discoverProviderModelsMock.mockRejectedValue(
			new Error("offline"),
		);

		await autoSyncEnabledProviders(undefined);
		expect(storeState.ai.lastModelAutoSyncAt).toBeUndefined();

		mocks.discoverProviderModelsMock.mockResolvedValue([
			{ name: "gpt-5.5", maxTokens: 1050000 },
		]);
		await autoSyncEnabledProviders(undefined);
		expect(storeState.ai.lastModelAutoSyncAt).toBeGreaterThan(0);
	});

	it("respects the daily throttle and the online-features gate", async () => {
		storeState.ai.lastModelAutoSyncAt = Date.now();
		expect(await autoSyncEnabledProviders(undefined)).toEqual([]);

		storeState.ai.lastModelAutoSyncAt = undefined;
		storeState.disableOnlineFeatures = true;
		expect(await autoSyncEnabledProviders(undefined)).toEqual([]);
		expect(mocks.discoverProviderModelsMock).not.toHaveBeenCalled();
	});
});
