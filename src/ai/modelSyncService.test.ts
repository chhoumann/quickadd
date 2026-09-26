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

const { autoSyncEnabledProviders, diffModelLists, syncProviderModels } = await import(
	"./modelSyncService"
);

function makeProvider(overrides: Partial<AIProvider> = {}): AIProvider {
	return {
		id: "openai",
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

		expect(result).toMatchObject({ added: 1, updated: 1 });
		expect(provider.lastModelSync).toEqual({ at: expect.any(Number) });
		expect(result.discovered.map((m) => m.name)).toEqual(["gpt-4o", "gpt-5.5"]);
		expect(provider.models.map((m) => m.name)).toEqual([
			"gpt-4o",
			"gpt-5.5",
		]);
		expect(provider.models[0].maxTokens).toBe(128000);
	});
});

describe("diffModelLists", () => {
	it("counts by name, not by length, so a list that lost entries still reports additions", () => {
		// The before list has a model the after list lacks (deleted mid-sync) and
		// vice versa: a length delta would report 0 new models.
		const before = [
			{ name: "gpt-4o", maxTokens: 128000 },
			{ name: "removed-by-user", maxTokens: 1000 },
			{ name: "o3", maxTokens: 200000, supportsTemperature: false },
		];
		const after = [
			{ name: "gpt-4o", maxTokens: 128000, maxOutputTokens: 16384 },
			{ name: "o3", maxTokens: 200000, supportsTemperature: false },
			{ name: "gpt-6-sol", maxTokens: 1050000 },
		];

		expect(diffModelLists(before, after)).toEqual({ added: 1, updated: 1 });
		expect(diffModelLists(after, after)).toEqual({ added: 0, updated: 0 });
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
				makeProvider({
					id: "custom",
					name: "Custom",
					endpoint: "http://x",
					autoSyncModels: false,
				}),
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

	it("records a failed background sync on the provider without touching its models", async () => {
		mocks.discoverProviderModelsMock.mockRejectedValue(new Error("status 503"));

		await autoSyncEnabledProviders(undefined);

		const [openai] = storeState.ai.providers as AIProvider[];
		expect(openai.models.map((m) => m.name)).toEqual(["gpt-4o"]);
		expect(openai.lastModelSync?.error).toBe("status 503");
		expect(openai.lastModelSync?.at).toBeGreaterThan(0);
	});

	it("stores a nonempty error when the thrown Error has an empty message", async () => {
		mocks.discoverProviderModelsMock.mockRejectedValue(new Error(""));

		await autoSyncEnabledProviders(undefined);

		const [openai] = storeState.ai.providers as AIProvider[];
		expect(openai.models.map((m) => m.name)).toEqual(["gpt-4o"]);
		expect(openai.lastModelSync?.error).toBeTruthy();
		expect(openai.lastModelSync?.error).not.toBe("");
	});

	it("keys sync results by provider id, not name+endpoint", async () => {
		const work = makeProvider({
			id: "openai-work",
			apiKey: "work-key",
			models: [{ name: "gpt-4o", maxTokens: 1 }],
		});
		const personal = makeProvider({
			id: "openai-personal",
			apiKey: "personal-key",
			models: [{ name: "gpt-4o", maxTokens: 1 }],
		});
		storeState.ai.providers = [work, personal];

		mocks.discoverProviderModelsMock.mockImplementation(
			async (provider: AIProvider) => {
				if (provider.id === "openai-work") {
					throw new Error("work key revoked");
				}
				return [{ name: "gpt-6-sol", maxTokens: 1050000 }];
			},
		);

		await autoSyncEnabledProviders(undefined);

		const [workAfter, personalAfter] = storeState.ai.providers as AIProvider[];
		expect(workAfter.id).toBe("openai-work");
		expect(workAfter.lastModelSync?.error).toBe("work key revoked");
		expect(workAfter.models.map((m) => m.name)).toEqual(["gpt-4o"]);
		expect(personalAfter.id).toBe("openai-personal");
		expect(personalAfter.lastModelSync?.error).toBeUndefined();
		expect(personalAfter.models.map((m) => m.name)).toEqual([
			"gpt-4o",
			"gpt-6-sol",
		]);
	});

	it("never adds a model the directory marks deprecated", async () => {
		mocks.discoverProviderModelsMock.mockResolvedValue([
			{ name: "gpt-4o", maxTokens: 128000, deprecated: true },
			{ name: "o1", maxTokens: 200000, deprecated: true },
			{ name: "gpt-6-sol", maxTokens: 1050000 },
		]);

		await autoSyncEnabledProviders(undefined);

		const [openai] = storeState.ai.providers as AIProvider[];
		expect(openai.models.map((m) => [m.name, !!m.deprecated])).toEqual([
			["gpt-4o", true],
			["gpt-6-sol", false],
		]);
		expect(openai.lastModelSync?.error).toBeUndefined();
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
