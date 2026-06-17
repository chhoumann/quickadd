import { describe, it, expect } from "vitest";
import { getProviderKind } from "./Provider";

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
