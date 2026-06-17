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
	});

	it("infers gemini from name or endpoint", () => {
		expect(getProviderKind({ name: "Gemini" })).toBe("gemini");
		expect(
			getProviderKind({ name: "Google", endpoint: "https://generativelanguage.googleapis.com" }),
		).toBe("gemini");
	});

	it("defaults unknown/OpenAI-compatible providers to openai", () => {
		expect(getProviderKind({ name: "Groq", endpoint: "https://api.groq.com/openai/v1" })).toBe("openai");
		expect(getProviderKind({ name: "OpenRouter" })).toBe("openai");
		expect(getProviderKind({})).toBe("openai");
	});
});
