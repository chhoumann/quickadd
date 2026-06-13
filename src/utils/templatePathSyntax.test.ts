import { describe, expect, it } from "vitest";
import { hasTemplatePathSyntax } from "./templatePathSyntax";

describe("hasTemplatePathSyntax", () => {
	it("detects a value token in a path", () => {
		expect(
			hasTemplatePathSyntax("Templates/{{value:collectionName}} Template.md"),
		).toBe(true);
	});

	it("detects a bare/date token", () => {
		expect(hasTemplatePathSyntax("Templates/{{date:YYYY}}.md")).toBe(true);
		expect(hasTemplatePathSyntax("{{VALUE}}")).toBe(true);
	});

	it("is false for a literal path", () => {
		expect(hasTemplatePathSyntax("Templates/Games Template.md")).toBe(false);
	});

	it("is false for stray single braces", () => {
		expect(hasTemplatePathSyntax("Templates/{notatoken}.md")).toBe(false);
	});

	it("is deliberately broad — flags any {{...}} even if not a real token", () => {
		// We can't fully validate a token at edit time; a wrong token simply
		// fails visibly at run time, so the builder still suppresses "not found".
		expect(hasTemplatePathSyntax("Templates/{{typo}}.md")).toBe(true);
	});
});
