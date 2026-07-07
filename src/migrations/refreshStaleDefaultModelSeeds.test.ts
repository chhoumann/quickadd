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

	it("normalizes the official OpenAI provider onto the curated directory source", async () => {
		const provider = legacyOpenAIProvider();
		provider.modelSource = "auto";
		setProviders([provider]);

		await refreshStaleDefaultModelSeeds.migrate(mockPlugin);

		expect(storedProvider("OpenAI")!.modelSource).toBe("modelsDev");
	});

	it("skips seeds whose name another provider already lists (bare-name lookup routes by first match)", async () => {
		const custom: AIProvider = {
			name: "Local o3",
			endpoint: "http://localhost:11434/v1",
			apiKey: "",
			models: [{ name: "o3", maxTokens: 8192 }],
			autoSyncModels: false,
			modelSource: "providerApi",
		};
		setProviders([legacyOpenAIProvider(), custom]);

		await refreshStaleDefaultModelSeeds.migrate(mockPlugin);

		const openai = storedProvider("OpenAI")!;
		expect(openai.models.some((m) => m.name === "o3")).toBe(false);
		// Other seeds still arrive.
		expect(openai.models.some((m) => m.name === "gpt-5.5")).toBe(true);
		// The custom provider's entry is untouched.
		expect(storedProvider("Local o3")!.models).toEqual([
			{ name: "o3", maxTokens: 8192 },
		]);
	});

	function seedAICommandChoice(
		model: string,
		modelParameters: Record<string, number>,
	) {
		settingsStore.setState({
			choices: [
				{
					id: "c1",
					name: "AI macro",
					type: "Macro",
					command: false,
					macro: {
						id: "m1",
						name: "AI macro",
						commands: [
							{
								id: "cmd1",
								name: "AI Assistant",
								type: "AIAssistant",
								model,
								systemPrompt: "",
								outputVariableName: "output",
								promptTemplate: { enable: false, name: "" },
								modelParameters,
							},
						],
					},
				},
			] as unknown as ReturnType<
				typeof settingsStore.getState
			>["choices"],
		});
	}

	function storedAICommand(): {
		model: string;
		modelParameters: Record<string, number>;
	} {
		const choice = settingsStore.getState().choices[0] as unknown as {
			macro: { commands: Array<{ model: string; modelParameters: Record<string, number> }> };
		};
		return choice.macro.commands[0];
	}

	it("re-points commands pinned to a retired model at Ask me", async () => {
		setProviders([legacyOpenAIProvider()]);
		seedAICommandChoice("gpt-4-32k", {});

		await refreshStaleDefaultModelSeeds.migrate(mockPlugin);

		expect(storedAICommand().model).toBe("Ask me");
	});

	it("keeps a pin when another provider still serves the removed model name", async () => {
		const proxy: AIProvider = {
			name: "My Proxy",
			endpoint: "https://my-proxy.example.com/v1",
			apiKey: "",
			models: [{ name: "gpt-4-32k", maxTokens: 32768 }],
			autoSyncModels: false,
			modelSource: "providerApi",
		};
		setProviders([legacyOpenAIProvider(), proxy]);
		seedAICommandChoice("gpt-4-32k", {});

		await refreshStaleDefaultModelSeeds.migrate(mockPlugin);

		// Removed from the official provider, but the proxy still serves it —
		// the command resolved (and keeps resolving) to the proxy.
		expect(
			storedProvider("OpenAI")!.models.some((m) => m.name === "gpt-4-32k"),
		).toBe(false);
		expect(storedAICommand().model).toBe("gpt-4-32k");
	});

	it("leaves commands pinned to live models alone", async () => {
		setProviders([legacyOpenAIProvider()]);
		seedAICommandChoice("gpt-4o", {});

		await refreshStaleDefaultModelSeeds.migrate(mockPlugin);

		expect(storedAICommand().model).toBe("gpt-4o");
	});

	it("strips the legacy baked-in sampling defaults but keeps user-set values", async () => {
		setProviders([legacyOpenAIProvider()]);
		seedAICommandChoice("gpt-4o", {
			temperature: 1,
			top_p: 1,
			frequency_penalty: 0,
			presence_penalty: 0,
		});

		await refreshStaleDefaultModelSeeds.migrate(mockPlugin);
		expect(storedAICommand().modelParameters).toEqual({});

		seedAICommandChoice("gpt-4o", {
			temperature: 0.4,
			top_p: 1,
			frequency_penalty: 0.5,
			presence_penalty: 0,
		});

		// Migration state was already flagged? migrate() runs the raw migration
		// function directly here, so run it again on the new choices.
		await refreshStaleDefaultModelSeeds.migrate(mockPlugin);
		expect(storedAICommand().modelParameters).toEqual({
			temperature: 0.4,
			frequency_penalty: 0.5,
		});
	});
});
