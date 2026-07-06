import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type QuickAdd from "src/main";
import type { AIProvider } from "src/ai/Provider";
import { CURRENT_MODEL_SEEDS } from "src/ai/Provider";
import { DEFAULT_SETTINGS } from "src/settings";
import { settingsStore } from "src/settingsStore";
import { deepClone } from "src/utils/deepClone";
import refreshStaleDefaultModelSeeds from "./refreshStaleDefaultModelSeeds";

const mockPlugin = {} as unknown as QuickAdd;

// The pre-2026 shipped seeds, as they exist in a long-time user's data.json.
function legacyOpenAIProvider(): AIProvider {
	return {
		name: "OpenAI",
		endpoint: "https://api.openai.com/v1",
		apiKey: "sk-user",
		models: [
			{ name: "gpt-3.5-turbo", maxTokens: 4096 },
			{ name: "gpt-4", maxTokens: 8192 },
			{ name: "gpt-4-32k", maxTokens: 32768 },
			{ name: "gpt-4-1106-preview", maxTokens: 128000 },
			{ name: "gpt-4o", maxTokens: 128000 },
		],
		autoSyncModels: false,
		modelSource: "modelsDev",
	};
}

function legacyGeminiProvider(): AIProvider {
	return {
		name: "Gemini",
		endpoint: "https://generativelanguage.googleapis.com",
		apiKey: "",
		models: [
			{ name: "gemini-1.5-pro", maxTokens: 1000000 },
			{ name: "gemini-1.5-flash", maxTokens: 1000000 },
			{ name: "gemini-1.5-flash-8b", maxTokens: 1000000 },
		],
		autoSyncModels: false,
		modelSource: "modelsDev",
	};
}

function setProviders(providers: AIProvider[], defaultModel = "Ask me"): void {
	const current = settingsStore.getState();
	settingsStore.setState({
		ai: { ...current.ai, providers, defaultModel },
	});
}

function storedProvider(name: string): AIProvider | undefined {
	return settingsStore
		.getState()
		.ai.providers.find((p: AIProvider) => p.name === name);
}

describe("refreshStaleDefaultModelSeeds migration", () => {
	beforeEach(() => {
		settingsStore.replaceState(deepClone(DEFAULT_SETTINGS));
	});

	afterEach(() => {
		settingsStore.replaceState(deepClone(DEFAULT_SETTINGS));
	});

	it("removes retired models and adds the current generation on official endpoints", async () => {
		setProviders([legacyOpenAIProvider(), legacyGeminiProvider()]);

		await refreshStaleDefaultModelSeeds.migrate(mockPlugin);

		const openai = storedProvider("OpenAI")!;
		const names = openai.models.map((m) => m.name);
		expect(names).not.toContain("gpt-4-32k");
		expect(names).not.toContain("gpt-4-1106-preview");
		// Live-but-legacy models the user had stay put.
		expect(names).toContain("gpt-3.5-turbo");
		expect(names).toContain("gpt-4");
		// Current seeds arrive.
		for (const seed of CURRENT_MODEL_SEEDS.openai) {
			expect(names).toContain(seed.name);
		}

		const gemini = storedProvider("Gemini")!;
		const geminiNames = gemini.models.map((m) => m.name);
		expect(geminiNames).not.toContain("gemini-1.5-pro");
		expect(geminiNames).not.toContain("gemini-1.5-flash");
		expect(geminiNames).not.toContain("gemini-1.5-flash-8b");
		for (const seed of CURRENT_MODEL_SEEDS.google) {
			expect(geminiNames).toContain(seed.name);
		}
	});

	it("refreshes stale metadata on models that match a current seed", async () => {
		const provider = legacyOpenAIProvider();
		provider.models.push({ name: "gpt-4o-mini", maxTokens: 4096 });
		setProviders([provider]);

		await refreshStaleDefaultModelSeeds.migrate(mockPlugin);

		const stored = storedProvider("OpenAI")!;
		const mini = stored.models.find((m) => m.name === "gpt-4o-mini")!;
		expect(mini.maxTokens).toBe(128_000);
		expect(mini.maxOutputTokens).toBe(16_384);
		expect(mini.supportsTemperature).toBe(true);
	});

	it("turns auto-sync on for official providers", async () => {
		setProviders([legacyOpenAIProvider()]);

		await refreshStaleDefaultModelSeeds.migrate(mockPlugin);

		expect(storedProvider("OpenAI")!.autoSyncModels).toBe(true);
	});

	it("never touches custom or proxy providers, even with colliding model names", async () => {
		const custom: AIProvider = {
			name: "My Proxy",
			endpoint: "https://my-proxy.example.com/v1",
			apiKey: "",
			models: [{ name: "gpt-4-32k", maxTokens: 32768 }],
			autoSyncModels: false,
			modelSource: "providerApi",
		};
		setProviders([custom]);

		await refreshStaleDefaultModelSeeds.migrate(mockPlugin);

		const stored = storedProvider("My Proxy")!;
		expect(stored.models).toEqual([{ name: "gpt-4-32k", maxTokens: 32768 }]);
		expect(stored.autoSyncModels).toBe(false);
	});

	it("resets the default model to Ask me when it was retired", async () => {
		setProviders([legacyOpenAIProvider()], "gpt-4-32k");

		await refreshStaleDefaultModelSeeds.migrate(mockPlugin);

		expect(settingsStore.getState().ai.defaultModel).toBe("Ask me");
	});

	it("keeps a default model that still exists", async () => {
		setProviders([legacyOpenAIProvider()], "gpt-4o");

		await refreshStaleDefaultModelSeeds.migrate(mockPlugin);

		expect(settingsStore.getState().ai.defaultModel).toBe("gpt-4o");
	});

	it("preserves the user's API key and provider identity", async () => {
		setProviders([legacyOpenAIProvider()]);

		await refreshStaleDefaultModelSeeds.migrate(mockPlugin);

		const stored = storedProvider("OpenAI")!;
		expect(stored.apiKey).toBe("sk-user");
		expect(stored.endpoint).toBe("https://api.openai.com/v1");
	});
});
