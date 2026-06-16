import { describe, expect, it } from "vitest";
import { Formatter } from "./formatter";

type Behavior = Parameters<Formatter["setLinkToCurrentFileBehavior"]>[0];

/**
 * Regression coverage for #1358: note-derived contextual tokens
 * ({{linkcurrent}}, {{linksection}}, {{filenamecurrent}}, {{folder}}/{{folder|name}},
 * {{title}}) used to resolve as separate sequential passes, so a later pass would
 * re-scan an earlier pass's generated output — corrupting a link, or looping forever
 * when the active file/title was literally named like a token.
 *
 * Every production entry point delegates to replaceCurrentFileTokensInString with a
 * token subset, so these tests drive that combined resolver directly with the exact
 * opts each entry point uses:
 *   formatFileContent     -> { links, fileName, folder, title }
 *   formatFileName        -> { fileName, folder }
 *   formatFolderPath      -> { folder }
 *   formatLocationString  -> { links, fileName, title }
 *   FileNameDisplay       -> { fileName, folder }
 *   FormatDisplay         -> { links, fileName, folder }
 */
class StubFormatter extends Formatter {
	private link: string | null = null;
	private section: string | null = null;
	private filename: string | null = null;
	private titleValue = "";

	constructor() {
		super();
	}

	protected async format(input: string): Promise<string> {
		return input;
	}
	protected getCurrentFileLink(): string | null {
		return this.link;
	}
	protected getCurrentFileLinkToSection(): string | null {
		return this.section;
	}
	protected getCurrentFileName(): string | null {
		return this.filename;
	}
	protected getVariableValue(name: string): string {
		return name === "title" ? this.titleValue : "";
	}
	protected async promptForValue(): Promise<string> {
		return "";
	}
	protected async promptForMathValue(): Promise<string> {
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

	setLink(v: string | null) {
		this.link = v;
	}
	setSection(v: string | null) {
		this.section = v;
	}
	setFilename(v: string | null) {
		this.filename = v;
	}
	setTitleValue(v: string) {
		this.titleValue = v;
	}
	setFolder(v: string | null) {
		this.setTargetFolderPath(v);
	}
	setBehavior(b: Behavior) {
		this.setLinkToCurrentFileBehavior(b);
	}

	// Expose the protected methods under test.
	combined(
		input: string,
		opts: { links?: boolean; fileName?: boolean; folder?: boolean; title?: boolean },
	) {
		return this.replaceCurrentFileTokensInString(input, opts);
	}
	linkCurrentStandalone(input: string) {
		return this.replaceLinkToCurrentFileInString(input);
	}
}

const allTokens = { links: true, fileName: true, folder: true, title: true } as const;

describe("#1358 note-derived token rescan", () => {
	describe("no infinite loop when a file/title is literally named like a token", () => {
		it("{{filenamecurrent}} body, file basename literally {{filenamecurrent}}", () => {
			const f = new StubFormatter();
			f.setFilename("{{filenamecurrent}}");
			expect(f.combined("{{FILENAMECURRENT}}", allTokens)).toBe("{{filenamecurrent}}");
		});

		it("{{linkcurrent}} body, file basename literally {{filenamecurrent}} keeps the link intact", () => {
			const f = new StubFormatter();
			f.setFilename("{{filenamecurrent}}");
			f.setLink("[[{{filenamecurrent}}]]");
			expect(f.combined("{{LINKCURRENT}}", allTokens)).toBe("[[{{filenamecurrent}}]]");
		});

		it("{{title}} body, title value literally {{title}}", () => {
			const f = new StubFormatter();
			f.setTitleValue("{{title}}");
			expect(f.combined("{{TITLE}}", allTokens)).toBe("{{title}}");
		});

		it("standalone replaceLinkToCurrentFileInString no longer loops on a {{linkcurrent}}-named file", async () => {
			const f = new StubFormatter();
			f.setBehavior("optional");
			f.setLink("[[{{linkcurrent}}]]");
			await expect(f.linkCurrentStandalone("{{LINKCURRENT}}")).resolves.toBe(
				"[[{{linkcurrent}}]]",
			);
		});
	});

	describe("no cross-pass corruption (a later token rewriting a generated link)", () => {
		it("a {{folder}} inside a generated link is NOT rewritten by the folder pass", () => {
			const f = new StubFormatter();
			f.setLink("[[{{folder}}]]");
			f.setFolder("Projects");
			expect(f.combined("{{LINKCURRENT}}", allTokens)).toBe("[[{{folder}}]]");
		});

		it("a {{title}} inside a generated link is NOT rewritten by the title pass", () => {
			const f = new StubFormatter();
			f.setLink("[[{{title}}]]");
			f.setTitleValue("Brand New Title");
			expect(f.combined("{{LINKCURRENT}}", allTokens)).toBe("[[{{title}}]]");
		});

		it("a {{filenamecurrent}} inside a generated section link is NOT rewritten by the filename pass", () => {
			const f = new StubFormatter();
			f.setSection("[[{{filenamecurrent}}#Heading]]");
			f.setFilename("real-basename");
			expect(f.combined("{{LINKSECTION}}", allTokens)).toBe(
				"[[{{filenamecurrent}}#Heading]]",
			);
		});
	});

	describe("inactive token categories are left literal (per entry point)", () => {
		it("formatFileName opts leave {{linkcurrent}} and {{title}} literal", () => {
			const f = new StubFormatter();
			f.setFilename("Note");
			f.setLink("[[Note]]");
			f.setTitleValue("T");
			f.setFolder("Inbox");
			expect(
				f.combined("{{LINKCURRENT}} {{FILENAMECURRENT}} {{FOLDER}} {{TITLE}}", {
					fileName: true,
					folder: true,
				}),
			).toBe("{{LINKCURRENT}} Note Inbox {{TITLE}}");
		});

		it("formatLocationString opts leave {{folder}} literal", () => {
			const f = new StubFormatter();
			f.setLink("[[Note]]");
			f.setFilename("Note");
			f.setTitleValue("T");
			expect(
				f.combined("{{LINKCURRENT}} {{FOLDER}} {{TITLE}}", {
					links: true,
					fileName: true,
					title: true,
				}),
			).toBe("[[Note]] {{FOLDER}} T");
		});

		it("a links-disabled entry point does not throw on a literal {{linkcurrent}} (required, no active file)", () => {
			const f = new StubFormatter();
			f.setBehavior("required");
			f.setLink(null);
			f.setFilename("Note");
			// formatFileName-style opts: links inactive -> token stays literal, no throw.
			expect(
				f.combined("{{LINKCURRENT}}-{{FILENAMECURRENT}}", {
					fileName: true,
					folder: true,
				}),
			).toBe("{{LINKCURRENT}}-Note");
		});
	});

	describe("required/optional + throw precedence preserved", () => {
		it("required + no active file throws the LINK message when a link token is active", () => {
			const f = new StubFormatter();
			f.setBehavior("required");
			f.setLink(null);
			f.setFilename(null);
			expect(() => f.combined("{{FILENAMECURRENT}} {{LINKCURRENT}}", allTokens)).toThrow(
				"Unable to get current file path",
			);
		});

		it("required + no active file throws the FILENAME message when only a filename token is active", () => {
			const f = new StubFormatter();
			f.setBehavior("required");
			f.setFilename(null);
			expect(() => f.combined("{{FILENAMECURRENT}}", allTokens)).toThrow(
				"Unable to get current file name",
			);
		});

		it("link message wins regardless of token order in the string", () => {
			const f = new StubFormatter();
			f.setBehavior("required");
			f.setLink(null);
			f.setFilename(null);
			// Filename token appears first, but the link message must still win.
			expect(() =>
				f.combined("{{FILENAMECURRENT}} then {{LINKCURRENT}}", allTokens),
			).toThrow("Unable to get current file path");
		});

		it("optional + no active file strips active link/filename tokens", () => {
			const f = new StubFormatter();
			f.setBehavior("optional");
			f.setLink(null);
			f.setFilename(null);
			expect(f.combined("a{{LINKCURRENT}}b{{FILENAMECURRENT}}c", allTokens)).toBe("abc");
		});
	});

	describe("folder + multi-occurrence + $-literal preserved", () => {
		it("{{FOLDER}} full path and {{FOLDER|name}} leaf, case-insensitive, $ literal", () => {
			const f = new StubFormatter();
			f.setFolder("A/B/Cash$Money");
			expect(f.combined("{{FOLDER}} | {{FOLDER|NAME}}", { folder: true })).toBe(
				"A/B/Cash$Money | Cash$Money",
			);
		});

		it("replaces multiple occurrences in one pass", () => {
			const f = new StubFormatter();
			f.setFilename("Doc");
			expect(
				f.combined("{{FILENAMECURRENT}}-{{FILENAMECURRENT}}", { fileName: true }),
			).toBe("Doc-Doc");
		});

		it("{{TITLE|name}} is not a valid token and stays literal", () => {
			const f = new StubFormatter();
			f.setTitleValue("T");
			expect(f.combined("{{TITLE|name}}", allTokens)).toBe("{{TITLE|name}}");
		});
	});
});
