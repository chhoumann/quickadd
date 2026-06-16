import { describe, expect, it } from "vitest";
import { Formatter } from "./formatter";

type Behavior = Parameters<Formatter["setLinkToCurrentFileBehavior"]>[0];

// Mirrors formatter-linkcurrent.test.ts: exercises the base replacer's
// required/optional behavior for {{linksection}} via a settable resolver.
class StubFormatter extends Formatter {
	constructor() {
		super();
	}

	private link: string | null = null;

	protected async format(input: string): Promise<string> {
		return input;
	}

	protected getCurrentFileLink(): string | null {
		return null;
	}

	protected getCurrentFileName(): string | null {
		return null;
	}

	protected getCurrentFileLinkToSection(): string | null {
		return this.link;
	}

	protected async promptForValue(): Promise<string> {
		return "";
	}

	protected async promptForMathValue(): Promise<string> {
		return "";
	}

	protected getVariableValue(_variableName: string): string {
		return "";
	}

	protected async suggestForValue(): Promise<string> {
		return "";
	}

	protected suggestForFile(): string {
		return "";
	}

	protected async suggestForField(): Promise<string> {
		return "";
	}

	protected async getMacroValue(): Promise<string> {
		return "";
	}

	protected async promptForVariable(): Promise<string> {
		return "";
	}

	protected async getTemplateContent(): Promise<string> {
		return "";
	}

	protected async getSelectedText(): Promise<string> {
		return "";
	}

	protected async getClipboardContent(): Promise<string> {
		return "";
	}

	protected isTemplatePropertyTypesEnabled(): boolean {
		return false;
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
