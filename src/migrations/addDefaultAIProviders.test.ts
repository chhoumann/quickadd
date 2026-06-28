import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type QuickAdd from "src/main";
import { DefaultProviders } from "src/ai/Provider";
import { DEFAULT_SETTINGS } from "src/settings";
import { settingsStore } from "src/settingsStore";
import { deepClone } from "src/utils/deepClone";
import addDefaultAIProviders from "./addDefaultAIProviders";

const mockPlugin = {} as unknown as QuickAdd;

function seedLegacyOpenAiKey(key: string): void {
	// OpenAIApiKey is a legacy field that no longer exists on the typed ai
	// settings; attach it via a cast so the migration's `"OpenAIApiKey" in ai`
	// branch has something to migrate.
	const current = settingsStore.getState();
	settingsStore.setState({
		ai: { ...current.ai, OpenAIApiKey: key } as typeof current.ai,
	});
}

describe("addDefaultAIProviders migration", () => {
	beforeEach(() => {
		settingsStore.replaceState(deepClone(DEFAULT_SETTINGS));
	});

	afterEach(() => {
		settingsStore.replaceState(deepClone(DEFAULT_SETTINGS));
	});

	it("does not mutate the shared DefaultProviders global with the user's key", async () => {
		seedLegacyOpenAiKey("sk-legacy");

		const openAiDefault = DefaultProviders.find((p) => p.name === "OpenAI");
		expect(openAiDefault?.apiKey).toBe("");

		await addDefaultAIProviders.migrate(mockPlugin);

		// The global default must stay pristine — the key must not leak into it.
		expect(openAiDefault?.apiKey).toBe("");
	});

	it("migrates the legacy key into the stored provider without aliasing the global", async () => {
		seedLegacyOpenAiKey("sk-legacy");

		await addDefaultAIProviders.migrate(mockPlugin);

		const storedProviders = settingsStore.getState().ai.providers;
		const storedOpenAi = storedProviders.find((p) => p.name === "OpenAI");
		expect(storedOpenAi?.apiKey).toBe("sk-legacy");

		// Stored providers must be independent copies, not the shared globals.
		for (const globalProvider of DefaultProviders) {
			expect(storedProviders).not.toContain(globalProvider);
		}

		// Mutating a stored copy must not bleed back into the global default.
		storedOpenAi?.models.push({ name: "leak-check", maxTokens: 1 });
		const openAiDefault = DefaultProviders.find((p) => p.name === "OpenAI");
		expect(openAiDefault?.models.some((m) => m.name === "leak-check")).toBe(
			false,
		);

		// The legacy plaintext key is removed from the ai settings.
		expect("OpenAIApiKey" in settingsStore.getState().ai).toBe(false);
	});

	it("populates providers byte-for-byte identical to the defaults (deep equal, no shared refs) when there is no legacy key", async () => {
		await addDefaultAIProviders.migrate(mockPlugin);

		const storedProviders = settingsStore.getState().ai.providers;

		// Same serialized data as the defaults — endpoint, kind, models,
		// autoSyncModels, modelSource, apiKey are all preserved.
		expect(storedProviders).toEqual(DefaultProviders);

		// ...but independent copies, not the shared global objects.
		for (const globalProvider of DefaultProviders) {
			expect(storedProviders).not.toContain(globalProvider);
		}
	});
});
