import { describe, expect, it } from "vitest";
import { Formatter } from "./formatter";

/**
 * Combined-pass semantics for {{FOLDERCURRENT}} (issue #1480): the active
 * file's folder, resolved in the same single function-replacer pass as the
 * other note-derived tokens (#1358). The distinguishing contracts under test:
 *  - "path" mode: a missing active file ALWAYS throws, even when the
 *    (append-link-controlled) behavior is "optional" — a strip would silently
 *    retarget the produced path to the vault root.
 *  - "content" mode: follows the sibling tokens' required/optional contract.
 *  - "" (root-level active file) is a legitimate resolution, never "missing".
 * CompleteFormatter's production wiring is covered in completeFormatter.test.ts.
 */

class StubFormatter extends Formatter {
	public activeFolderPath: string | null = null;

	constructor() {
		super();
	}

	protected async format(input: string): Promise<string> {
		return input;
	}

	protected getCurrentFileLink(): string | null {
		return null;
	}

	protected getCurrentFileName(): string | null {
		return "ActiveNote";
	}

	protected getCurrentFolderPath(): string | null {
		return this.activeFolderPath;
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

	public processPath(input: string): string {
		return this.replaceCurrentFileTokensInString(input, {
			fileName: true,
			folder: true,
			activeFolder: "path",
		});
	}

	public processContent(input: string): string {
		return this.replaceCurrentFileTokensInString(input, {
			links: true,
			fileName: true,
			folder: true,
			activeFolder: "content",
			title: true,
		});
	}

	public processWithoutActiveFolder(input: string): string {
		return this.replaceCurrentFileTokensInString(input, {
			fileName: true,
			folder: true,
		});
	}
}

function makeFormatter(activeFolderPath: string | null): StubFormatter {
	const formatter = new StubFormatter();
	formatter.activeFolderPath = activeFolderPath;
	return formatter;
}

describe("Formatter {{FOLDERCURRENT}} token", () => {
	it("resolves {{FOLDERCURRENT}} to the active file's folder path in a capture target", () => {
		const formatter = makeFormatter("Projects/Alpha");
		expect(formatter.processPath("{{FOLDERCURRENT}}/Project Tasks.md")).toBe(
			"Projects/Alpha/Project Tasks.md",
		);
	});

	it("resolves {{FOLDERCURRENT|name}} to the leaf folder segment", () => {
		const formatter = makeFormatter("Projects/Alpha");
		expect(formatter.processPath("{{FOLDERCURRENT|name}} tasks")).toBe(
			"Alpha tasks",
		);
	});

	it("treats a single-segment folder as both full path and leaf", () => {
		const formatter = makeFormatter("Inbox");
		expect(
			formatter.processPath("{{FOLDERCURRENT}}|{{FOLDERCURRENT|name}}"),
		).toBe("Inbox|Inbox");
	});

	it("is case-insensitive for the token and the modifier", () => {
		const formatter = makeFormatter("Projects/Alpha");
		expect(
			formatter.processPath("{{foldercurrent}} / {{FolderCurrent|NAME}}"),
		).toBe("Projects/Alpha / Alpha");
	});

	it("replaces multiple occurrences in one pass", () => {
		const formatter = makeFormatter("A/B");
		expect(formatter.processPath("{{FOLDERCURRENT}}-{{FOLDERCURRENT}}")).toBe(
			"A/B-A/B",
		);
	});

	it("treats '$' in a folder name literally (no regex re-expansion)", () => {
		const formatter = makeFormatter("Cash$Money");
		expect(formatter.processPath("{{FOLDERCURRENT}}")).toBe("Cash$Money");
	});

	it("treats a root-level active file ('') as a legitimate resolution, not missing", () => {
		const formatter = makeFormatter("");
		// Downstream (resolveCaptureTarget / normalizeMarkdownFilePath) strips the
		// leading slash, landing the capture at the vault root — the correct
		// sibling of a root-level note.
		expect(formatter.processPath("{{FOLDERCURRENT}}/Tasks.md")).toBe(
			"/Tasks.md",
		);
		expect(formatter.processPath("{{FOLDERCURRENT|name}}")).toBe("");
	});

	it("keeps {{FOLDER}} and {{FOLDERCURRENT}} independent in one pass", () => {
		const formatter = makeFormatter("Projects/Alpha");
		formatter.setTargetFolderPath("Journal/Daily");
		expect(
			formatter.processPath(
				"{{FOLDER}} + {{FOLDERCURRENT}} + {{FOLDER|name}} + {{FOLDERCURRENT|name}}",
			),
		).toBe("Journal/Daily + Projects/Alpha + Daily + Alpha");
	});

	it("leaves the token verbatim when the activeFolder category is inactive", () => {
		const formatter = makeFormatter("Projects/Alpha");
		expect(formatter.processWithoutActiveFolder("{{FOLDERCURRENT}}/x")).toBe(
			"{{FOLDERCURRENT}}/x",
		);
	});

	it("does not re-scan a folder value that is itself named like a token (#1358)", () => {
		const formatter = makeFormatter("{{filenamecurrent}}");
		// The folder value must be inserted literally while the real
		// {{FILENAMECURRENT}} elsewhere still resolves independently.
		expect(
			formatter.processPath("{{FOLDERCURRENT}}/{{FILENAMECURRENT}}"),
		).toBe("{{filenamecurrent}}/ActiveNote");
	});

	describe("missing active file", () => {
		const error =
			"Unable to get the active file's folder. Make sure you have a file open in the editor.";

		it("throws in path mode with required behavior", () => {
			const formatter = makeFormatter(null);
			expect(() => formatter.processPath("{{FOLDERCURRENT}}/x.md")).toThrow(
				error,
			);
		});

		it("throws in path mode even when behavior is optional (no silent root capture)", () => {
			const formatter = makeFormatter(null);
			formatter.setLinkToCurrentFileBehavior("optional");
			expect(() => formatter.processPath("{{FOLDERCURRENT}}/x.md")).toThrow(
				error,
			);
		});

		it("throws in content mode with required behavior", () => {
			const formatter = makeFormatter(null);
			expect(() => formatter.processContent("in {{FOLDERCURRENT}}")).toThrow(
				error,
			);
		});

		it("strips in content mode when behavior is optional", () => {
			const formatter = makeFormatter(null);
			formatter.setLinkToCurrentFileBehavior("optional");
			expect(formatter.processContent("in [{{FOLDERCURRENT}}]")).toBe(
				"in []",
			);
		});
	});
});
