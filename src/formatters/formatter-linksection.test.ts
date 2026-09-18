import { StubFormatter as FormatterStub } from "../../tests/helpers/formatters/stubFormatter";
import { describe, expect, it } from "vitest";
import type { Formatter } from "./formatter";

type Behavior = Parameters<Formatter["setLinkToCurrentFileBehavior"]>[0];

// Mirrors formatter-linkcurrent.test.ts: exercises the base replacer's
// required/optional behavior for {{linksection}} via a settable resolver.
class StubFormatter extends FormatterStub {

	private link: string | null = null;

	protected getCurrentFileLinkToSection(): string | null {
		return this.link;
	}

	public setLink(link: string | null) {
		this.link = link;
	}

	public process(input: string): string {
		return this.replaceLinkToCurrentSectionInString(input);
	}

	public setBehavior(behavior: Behavior) {
		this.setLinkToCurrentFileBehavior(behavior);
	}
}

describe("Formatter {{linksection}} behavior", () => {
	it("throws when required and no active file", () => {
		const formatter = new StubFormatter();
		formatter.setLink(null);
		expect(() => formatter.process("{{LINKSECTION}}")).toThrow(
			"Unable to get current file path",
		);
	});

	it("silently strips placeholder when optional and no active file", () => {
		const formatter = new StubFormatter();
		formatter.setBehavior("optional");
		formatter.setLink(null);
		expect(formatter.process("Before {{LINKSECTION}} after")).toBe(
			"Before  after",
		);
	});

	it("replaces placeholder with the section link when available", () => {
		const formatter = new StubFormatter();
		formatter.setBehavior("optional");
		formatter.setLink("[[Note#Heading]]");
		expect(formatter.process("See: {{LINKSECTION}}")).toBe(
			"See: [[Note#Heading]]",
		);
	});

	it("replaces every occurrence and is case-insensitive", () => {
		const formatter = new StubFormatter();
		formatter.setLink("[[Note#H]]");
		expect(
			formatter.process("{{linksection}} / {{LINKSECTION}}"),
		).toBe("[[Note#H]] / [[Note#H]]");
	});

	it("does not invoke the resolver when the token is absent", () => {
		const formatter = new StubFormatter();
		// Resolver returns null (would throw in required mode) — but with no
		// token present the regex-first guard must skip it entirely.
		formatter.setLink(null);
		expect(formatter.process("plain text, no token")).toBe(
			"plain text, no token",
		);
	});
});
