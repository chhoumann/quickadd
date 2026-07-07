import { beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_SETTINGS } from "src/settings";
import { settingsStore } from "src/settingsStore";
import { deepClone } from "src/utils/deepClone";
import { log } from "src/logger/logManager";
import type { AIProvider } from "./Provider";
import {
	resetModelResolutionWarnings,
	resolveModel,
	resolveModelInputOrThrow,
	resolveModelScoped,
} from "./aiHelpers";

function provider(overrides: Partial<AIProvider>): AIProvider {
	return {
		name: "Provider",
		endpoint: "https://example.test/v1",
		apiKey: "",
		models: [],
		modelSource: "providerApi",
		...overrides,
	};
}

// The #1495 collision scenario: native OpenAI plus an OpenRouter-style proxy
// whose LITERAL model ids carry vendor prefixes, including "openai/gpt-4o".
function openAI(): AIProvider {
	return provider({
		id: "openai",
		name: "OpenAI",
		endpoint: "https://api.openai.com/v1",
		models: [
			{ name: "gpt-4o", maxTokens: 128_000 },
			{ name: "o3", maxTokens: 200_000 },
		],
	});
}

function openRouter(): AIProvider {
	return provider({
		id: "openrouter",
		name: "OpenRouter",
		endpoint: "https://openrouter.ai/api/v1",
		models: [
			{ name: "openai/gpt-4o", maxTokens: 128_000 },
			{ name: "gpt-4o", maxTokens: 64_000 },
		],
	});
}

function setProviders(providers: AIProvider[]): void {
	const current = settingsStore.getState();
	settingsStore.setState({ ai: { ...current.ai, providers } });
}

beforeEach(() => {
	settingsStore.replaceState(deepClone(DEFAULT_SETTINGS));
	resetModelResolutionWarnings();
	vi.restoreAllMocks();
});

describe("resolveModel — object refs (pinned commands)", () => {
	it("resolves by stable provider id, not first match", () => {
		setProviders([openRouter(), openAI()]);

		const resolved = resolveModel({ providerId: "openai", name: "gpt-4o" });

		expect(resolved?.provider.name).toBe("OpenAI");
		expect(resolved?.model.maxTokens).toBe(128_000);
	});

	it("falls back to first-match with a warning when the pinned provider is gone", () => {
		const warn = vi.spyOn(log, "logWarning").mockImplementation(() => {});
		setProviders([openRouter()]);

		const resolved = resolveModel({ providerId: "openai", name: "gpt-4o" });

		expect(resolved?.provider.name).toBe("OpenRouter");
		expect(warn).toHaveBeenCalledTimes(1);
		expect(warn.mock.calls[0][0]).toContain('pinned to provider "openai"');
	});

	it("warns only once per dangling ref (settings modals re-render per keystroke)", () => {
		const warn = vi.spyOn(log, "logWarning").mockImplementation(() => {});
		setProviders([openRouter()]);

		resolveModel({ providerId: "openai", name: "gpt-4o" });
		resolveModel({ providerId: "openai", name: "gpt-4o" });

		expect(warn).toHaveBeenCalledTimes(1);
	});

	it("re-warns when the SAME dangling ref later falls back to a different provider", () => {
		const warn = vi.spyOn(log, "logWarning").mockImplementation(() => {});
		setProviders([openRouter()]);
		resolveModel({ providerId: "openai", name: "gpt-4o" });

		const other = provider({
			id: "groq",
			name: "Groq",
			models: [{ name: "gpt-4o", maxTokens: 1 }],
		});
		setProviders([other, openRouter()]);
		resolveModel({ providerId: "openai", name: "gpt-4o" });

		expect(warn).toHaveBeenCalledTimes(2);
	});

	it("silent resolution never consumes the warn-once budget of a later run", () => {
		const warn = vi.spyOn(log, "logWarning").mockImplementation(() => {});
		setProviders([openRouter()]);

		// A settings modal rendering with the dangling ref…
		resolveModel({ providerId: "openai", name: "gpt-4o" }, { silent: true });
		expect(warn).not.toHaveBeenCalled();

		// …must not silence the warning when the command actually RUNS.
		resolveModel({ providerId: "openai", name: "gpt-4o" });
		expect(warn).toHaveBeenCalledTimes(1);
	});

	it("returns undefined when neither the pin nor any provider serves the model", () => {
		setProviders([openAI()]);

		expect(
			resolveModel({ providerId: "gone", name: "no-such-model" }),
		).toBeUndefined();
	});
});

describe("resolveModel — strings", () => {
	it("keeps legacy first-match for bare names, in provider order", () => {
		setProviders([openRouter(), openAI()]);

		const resolved = resolveModel("gpt-4o");

		expect(resolved?.provider.name).toBe("OpenRouter");
		expect(resolved?.model.maxTokens).toBe(64_000);
	});

	it("warns once when a bare name is served by several providers", () => {
		const warn = vi.spyOn(log, "logWarning").mockImplementation(() => {});
		setProviders([openRouter(), openAI()]);

		resolveModel("gpt-4o");
		resolveModel("gpt-4o");

		expect(warn).toHaveBeenCalledTimes(1);
		expect(warn.mock.calls[0][0]).toContain("openai/gpt-4o");
		expect(warn.mock.calls[0][0]).toContain("openrouter/gpt-4o");
	});

	it("lets a LITERAL slash-named model shadow the qualified form (legacy scripts win)", () => {
		setProviders([openAI(), openRouter()]);

		// OpenRouter literally serves a model named "openai/gpt-4o"; a script
		// passing that string resolved to it before #1495 and still must.
		const resolved = resolveModel("openai/gpt-4o");

		expect(resolved?.provider.name).toBe("OpenRouter");
		expect(resolved?.model.name).toBe("openai/gpt-4o");
	});

	it("reads provider/model as qualified when no literal name matches", () => {
		setProviders([openRouter(), openAI()]);

		const resolved = resolveModel("openai/o3");

		expect(resolved?.provider.name).toBe("OpenAI");
		expect(resolved?.model.name).toBe("o3");
	});

	it("matches the qualified prefix against display names too, case-insensitively", () => {
		setProviders([openAI()]);

		expect(resolveModel("OpenAI/o3")?.model.name).toBe("o3");
		expect(resolveModel("openai/o3")?.model.name).toBe("o3");
	});

	it("splits at the FIRST slash so slash-named models stay addressable per provider", () => {
		setProviders([openAI(), openRouter()]);

		const resolved = resolveModel("openrouter/openai/gpt-4o");

		expect(resolved?.provider.name).toBe("OpenRouter");
		expect(resolved?.model.name).toBe("openai/gpt-4o");
	});

	it("tolerates null/undefined input (malformed persisted data) instead of throwing", () => {
		setProviders([openAI()]);

		expect(
			resolveModel(undefined as unknown as string),
		).toBeUndefined();
		expect(resolveModel(null as unknown as string)).toBeUndefined();
	});

	it("returns undefined for unknown names and degenerate qualified forms", () => {
		setProviders([openAI()]);

		expect(resolveModel("nope")).toBeUndefined();
		expect(resolveModel("/gpt-4o")).toBeUndefined();
		expect(resolveModel("openai/")).toBeUndefined();
		expect(resolveModel("nope/gpt-4o")).toBeUndefined();
	});
});

describe("resolveModelScoped", () => {
	it("is never shadowed by another provider's literal slash-named model", () => {
		setProviders([openRouter(), openAI()]);

		const resolved = resolveModelScoped("openai", "gpt-4o");

		expect(resolved?.provider.name).toBe("OpenAI");
		expect(resolved?.model.maxTokens).toBe(128_000);
	});

	it("returns undefined when the provider doesn't serve the model", () => {
		setProviders([openAI()]);

		expect(resolveModelScoped("openai", "gemini-2.5-pro")).toBeUndefined();
	});
});

describe("resolveModelInputOrThrow", () => {
	it("throws for empty or nameless input", () => {
		setProviders([openAI()]);

		expect(() => resolveModelInputOrThrow("")).toThrow(
			"Invalid model parameter",
		);
		expect(() =>
			resolveModelInputOrThrow({} as { name: string }),
		).toThrow("Invalid model parameter");
	});

	it("scopes exactly via the object form's provider — the shadow escape hatch", () => {
		setProviders([openAI(), openRouter()]);

		// The string form resolves to OpenRouter's literal model (legacy rule);
		// the object form must reach native OpenAI regardless.
		const viaString = resolveModelInputOrThrow("openai/gpt-4o");
		const viaObject = resolveModelInputOrThrow({
			provider: "openai",
			name: "gpt-4o",
		});

		expect(viaString.provider.name).toBe("OpenRouter");
		expect(viaObject.provider.name).toBe("OpenAI");
	});

	it("suggests qualified forms when a qualified string misses", () => {
		setProviders([openAI(), openRouter()]);

		expect(() =>
			resolveModelInputOrThrow("gemini/gpt-4o"),
		).toThrow(/Did you mean/);
	});

	it("suggests the object form when a qualified string is shadowed by a literal model id", () => {
		const warn = vi.spyOn(log, "logWarning").mockImplementation(() => {});
		setProviders([openAI(), openRouter()]);

		// "openai/gpt-4o" is a literal model id on OpenRouter, so suggesting the
		// string form for native OpenAI would route users to OpenRouter.
		resolveModel("gpt-4o");

		expect(warn).toHaveBeenCalledTimes(1);
		expect(warn.mock.calls[0][0]).toContain(
			'{ name: "gpt-4o", provider: "openai" }',
		);
	});

	it("points at settings when nothing matches at all", () => {
		setProviders([openAI()]);

		expect(() => resolveModelInputOrThrow("claude-x")).toThrow(
			"not found in configured providers",
		);
	});
});
