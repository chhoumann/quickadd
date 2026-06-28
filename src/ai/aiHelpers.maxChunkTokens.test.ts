import { beforeEach, describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS } from "src/settings";
import { settingsStore } from "src/settingsStore";
import { deepClone } from "src/utils/deepClone";
import type { AIProvider } from "src/ai/Provider";
import {
	getLargestModelMaxTokens,
	getMaxChunkTokensUpperBound,
} from "./aiHelpers";
import { estimateModelInputBudget } from "./tokenEstimator";

function setProviders(providers: AIProvider[]): void {
	settingsStore.setState({
		ai: { ...settingsStore.getState().ai, providers },
	});
}

function provider(name: string, models: AIProvider["models"]): AIProvider {
	return {
		name,
		endpoint: "https://example.com/v1",
		apiKey: "",
		models,
		modelSource: "providerApi",
	};
}

describe("getLargestModelMaxTokens", () => {
	beforeEach(() => {
		settingsStore.replaceState(deepClone(DEFAULT_SETTINGS));
	});

	it("returns the most permissive configured model's context window", () => {
		setProviders([
			provider("A", [{ name: "small", maxTokens: 4096 }]),
			provider("B", [{ name: "big", maxTokens: 200000 }]),
		]);
		expect(getLargestModelMaxTokens()).toBe(200000);
	});

	it("ignores non-finite / non-positive maxTokens values", () => {
		setProviders([
			provider("A", [
				{ name: "bad", maxTokens: Number.NaN },
				{ name: "zero", maxTokens: 0 },
				{ name: "ok", maxTokens: 8000 },
			]),
		]);
		expect(getLargestModelMaxTokens()).toBe(8000);
	});

	it("falls back to a conservative default when no models are configured", () => {
		setProviders([]);
		expect(getLargestModelMaxTokens()).toBe(4096);
	});
});

describe("getMaxChunkTokensUpperBound", () => {
	beforeEach(() => {
		settingsStore.replaceState(deepClone(DEFAULT_SETTINGS));
		setProviders([
			provider("OpenAI", [{ name: "gpt-x", maxTokens: 128000 }]),
			provider("Big", [{ name: "huge", maxTokens: 1000000 }]),
		]);
	});

	it("uses the selected model's budget minus the system-prompt overhead", () => {
		expect(getMaxChunkTokensUpperBound("gpt-x", 0)).toBe(
			estimateModelInputBudget(128000),
		);
		expect(getMaxChunkTokensUpperBound("gpt-x", 1000)).toBe(
			estimateModelInputBudget(128000) - 1000,
		);
	});

	it("falls back to the largest configured model for the 'Ask me' sentinel", () => {
		// "Ask me" is not a real model; it must not throw and must yield the
		// most-permissive bound rather than collapsing to the floor.
		expect(getMaxChunkTokensUpperBound("Ask me", 0)).toBe(
			estimateModelInputBudget(1000000),
		);
	});

	it("falls back for a model that no longer exists", () => {
		expect(getMaxChunkTokensUpperBound("deleted-model", 0)).toBe(
			estimateModelInputBudget(1000000),
		);
	});

	it("never returns below 1 even when the system prompt exceeds the budget", () => {
		expect(getMaxChunkTokensUpperBound("gpt-x", 10_000_000)).toBe(1);
	});
});
