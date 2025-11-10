import { beforeEach, describe, expect, it, vi } from "vitest";

const runLive = process.env.LIVE_DISCOVERY_TESTS === "1";

const storeState = vi.hoisted(() => ({
	disableOnlineFeatures: false,
	ai: { providers: [] },
}));

vi.mock("obsidian", () => ({
	requestUrl: async (options: { url: string; method?: string; headers?: Record<string, string>; body?: BodyInit }) => {
		const response = await fetch(options.url, {
			method: options.method ?? "GET",
			headers: options.headers,
			body: options.body,
		});
		const text = await response.text();
		if (!response.ok) {
			throw new Error(`${response.status} ${response.statusText}: ${text}`);
		}
		return {
			json: Promise.resolve().then(() => JSON.parse(text)),
			text: Promise.resolve(text),
			status: response.status,
		};
	},
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

const { discoverProviderModels } = await import("./modelDiscoveryService");

(runLive ? describe : describe.skip)("model discovery live providers", () => {
	beforeEach(() => {
		storeState.disableOnlineFeatures = false;
	});

	it("fetches models from local Ollama", async () => {
		const models = await discoverProviderModels({
			name: "Ollama",
			endpoint: "http://localhost:11434/v1",
			apiKey: "",
			models: [],
			autoSyncModels: false,
			modelSource: "providerApi",
		});

		expect(models.length).toBeGreaterThan(0);
	});

	it("fetches models from OpenRouter", async () => {
		const apiKey = process.env.OPENROUTER_API_KEY;
		if (!apiKey) {
			throw new Error("Set OPENROUTER_API_KEY to run this test.");
		}

		const models = await discoverProviderModels({
			name: "OpenRouter",
			endpoint: "https://openrouter.ai/api/v1",
			apiKey,
			models: [],
			autoSyncModels: false,
			modelSource: "providerApi",
		});

		expect(models.length).toBeGreaterThan(0);
		const hasOpenRouterModel = models.some((m) => m.name.includes("openrouter"));
		expect(hasOpenRouterModel).toBe(true);
	});
});
