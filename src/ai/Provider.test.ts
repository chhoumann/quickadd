import { describe, it, expect } from "vitest";
import type { AIProvider } from "./Provider";
import {
	activeModelRef,
	ensureProviderIds,
	getProviderKind,
	slugifyProviderId,
	uniqueProviderId,
} from "./Provider";

describe("getProviderKind", () => {
	it("prefers an explicit kind", () => {
		expect(getProviderKind({ kind: "anthropic", name: "Whatever" })).toBe("anthropic");
		expect(getProviderKind({ kind: "openai", name: "Anthropic" })).toBe("openai");
	});

	it("infers anthropic from name or endpoint", () => {
		expect(getProviderKind({ name: "Anthropic" })).toBe("anthropic");
		expect(getProviderKind({ name: "My Claude", endpoint: "https://api.anthropic.com" })).toBe("anthropic");
		expect(getProviderKind({ name: "Claude Proxy", endpoint: "https://api.anthropic.com/v1/messages" })).toBe("anthropic");
		// scheme-less endpoints still parse
		expect(getProviderKind({ name: "X", endpoint: "api.anthropic.com" })).toBe("anthropic");
	});

	it("infers gemini from name or endpoint", () => {
		expect(getProviderKind({ name: "Gemini" })).toBe("gemini");
		expect(
			getProviderKind({ name: "Google", endpoint: "https://generativelanguage.googleapis.com" }),
		).toBe("gemini");
	});

	it("matches the hostname precisely, not a substring of the URL (CodeQL js/incomplete-url-substring-sanitization)", () => {
		// The known host appearing in the path/query or as a fake subdomain prefix must NOT match.
		expect(getProviderKind({ name: "Evil", endpoint: "https://evil.com/?x=api.anthropic.com" })).toBe("openai");
		expect(getProviderKind({ name: "Evil", endpoint: "https://api.anthropic.com.attacker.example/v1" })).toBe("openai");
		expect(getProviderKind({ name: "Evil", endpoint: "https://generativelanguage.googleapis.com.evil.test" })).toBe("openai");
	});

	it("defaults unknown/OpenAI-compatible providers to openai", () => {
		expect(getProviderKind({ name: "Groq", endpoint: "https://api.groq.com/openai/v1" })).toBe("openai");
		expect(getProviderKind({ name: "OpenRouter" })).toBe("openai");
		expect(getProviderKind({ endpoint: "not a url" })).toBe("openai");
		expect(getProviderKind({})).toBe("openai");
	});
});

function bareProvider(name: string, id?: string): AIProvider {
	return {
		id,
		name,
		endpoint: "https://example.test",
		apiKey: "",
		models: [],
		modelSource: "providerApi",
	};
}

describe("slugifyProviderId", () => {
	it("lowercases and collapses non-alphanumerics to single dashes", () => {
		expect(slugifyProviderId("OpenAI")).toBe("openai");
		expect(slugifyProviderId("Hugging Face")).toBe("hugging-face");
		expect(slugifyProviderId("My  LLM! Proxy")).toBe("my-llm-proxy");
	});

	it("never emits a slash (the qualified-form delimiter) and never an empty id", () => {
		expect(slugifyProviderId("a/b/c")).toBe("a-b-c");
		expect(slugifyProviderId("///")).toBe("provider");
		expect(slugifyProviderId("")).toBe("provider");
	});
});

describe("uniqueProviderId / ensureProviderIds", () => {
	it("suffixes when the base id is taken", () => {
		const providers = [bareProvider("OpenAI", "openai")];
		expect(uniqueProviderId("openai", providers)).toBe("openai-2");
	});

	it("enforces the slug charset on any base, not just caller discipline", () => {
		expect(uniqueProviderId("My/Weird Provider", [])).toBe(
			"my-weird-provider",
		);
	});

	it("reassigns duplicate EXISTING ids so refs stay unambiguous (first keeps it)", () => {
		const providers = [
			bareProvider("OpenAI", "openai"),
			bareProvider("OpenAI Clone", "openai"),
		];

		expect(ensureProviderIds(providers)).toBe(true);
		expect(providers.map((p) => p.id)).toEqual(["openai", "openai-2"]);
	});

	it("assigns ids only to providers lacking one, uniquely, and reports changes", () => {
		const providers = [
			bareProvider("OpenAI", "openai"),
			bareProvider("Custom"),
			bareProvider("Custom"),
		];

		expect(ensureProviderIds(providers)).toBe(true);
		expect(providers.map((p) => p.id)).toEqual([
			"openai",
			"custom",
			"custom-2",
		]);
		// Second pass: nothing to do.
		expect(ensureProviderIds(providers)).toBe(false);
	});
});

describe("activeModelRef", () => {
	it("returns the ref only while it matches the legacy string", () => {
		const ref = { providerId: "openai", name: "gpt-4o" };
		expect(activeModelRef("gpt-4o", ref)).toBe(ref);
		// Drift: an older QuickAdd rewrote the string; the stale ref is inert.
		expect(activeModelRef("o3", ref)).toBeUndefined();
		expect(activeModelRef(undefined, ref)).toBeUndefined();
		expect(activeModelRef("gpt-4o", undefined)).toBeUndefined();
	});
});
