import { describe, expect, it } from "vitest";
import { basenameWithoutMdOrCanvas, isPathWithinFolder } from "./pathUtils";

describe("isPathWithinFolder", () => {
	it("matches the folder itself and its descendants", () => {
		expect(isPathWithinFolder("A", "A")).toBe(true);
		expect(isPathWithinFolder("A/B1", "A")).toBe(true);
		expect(isPathWithinFolder("A/B1/C1.md", "A")).toBe(true);
	});

	it("does not match plain sibling prefixes", () => {
		expect(isPathWithinFolder("A2", "A")).toBe(false);
		expect(isPathWithinFolder("A2/B1", "A")).toBe(false);
		expect(isPathWithinFolder("A.md", "A")).toBe(false);
	});

	it("normalizes separators before matching", () => {
		expect(isPathWithinFolder("/A/B1/", "A/")).toBe(true);
		expect(isPathWithinFolder("/A2/B1/", "A/")).toBe(false);
		expect(isPathWithinFolder("A\\B1\\x.md", "A")).toBe(true);
	});

	it("treats a blank folder as the vault root", () => {
		expect(isPathWithinFolder("A/x.md", "")).toBe(true);
		expect(isPathWithinFolder("x.md", "/")).toBe(true);
	});
});

describe("basenameWithoutMdOrCanvas", () => {
	it("drops folders and a trailing markdown-family extension", () => {
		expect(basenameWithoutMdOrCanvas("People/Tom.md")).toBe("Tom");
		expect(basenameWithoutMdOrCanvas("a/b/My.Notes.md")).toBe("My.Notes");
		expect(basenameWithoutMdOrCanvas("Diagrams/x.canvas")).toBe("x");
		expect(basenameWithoutMdOrCanvas("Alice")).toBe("Alice");
	});
});
