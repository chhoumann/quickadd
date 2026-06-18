import { TFile } from "obsidian";
import type { App } from "obsidian";
import { describe, expect, it, vi } from "vitest";
import { Formatter } from "./formatter";
import {
	FILE_CUSTOM_PREFIX,
	FILE_PICK_PREFIX,
	type ParsedFileToken,
} from "../utils/fileSyntax";

function makeFile(path: string): TFile {
	const segment = path.split("/").pop() ?? path;
	const basename = segment.replace(/\.md$/, "");
	const parentPath = path.includes("/")
		? path.slice(0, path.lastIndexOf("/"))
		: "/";
	return Object.assign(new TFile(), {
		path,
		name: segment,
		basename,
		parent: { path: parentPath },
	});
}

// A stub app where given paths resolve to real TFiles and links render in a
// recognizable shape so link mode is observable.
function makeApp(paths: string[]) {
	const files = new Map(paths.map((p) => [p, makeFile(p)]));
	return {
		vault: {
			getAbstractFileByPath: (p: string) => files.get(p) ?? null,
		},
		fileManager: {
			generateMarkdownLink: vi.fn(
				(file: TFile, source: string) => `[[${file.basename}@${source}]]`,
			),
		},
	};
}

class FileTestFormatter extends Formatter {
	public calls = 0;
	private linkSource: string | null;

	constructor(
		app: unknown,
		private responder: (parsed: ParsedFileToken) => string | string[],
		linkSource: string | null = null,
	) {
		super(app as App);
		this.linkSource = linkSource;
	}

	protected getLinkSourcePath(): string | null {
		return this.linkSource;
	}

	protected suggestForFile(parsed: ParsedFileToken): string | string[] {
		this.calls += 1;
		return this.responder(parsed);
	}

	public run(input: string): Promise<string> {
		return this.replaceFileInString(input);
	}

	public runWithPropertyCollection(input: string): Promise<string> {
		return this.withTemplatePropertyCollection(() =>
			this.replaceFileInString(input),
		);
	}

	/** Test seam: pre-seed a stored FILE value to exercise rendering directly. */
	public seed(key: string, value: string): void {
		this.variables.set(key, value);
	}

	// --- inert abstract impls ---
	protected async format(input: string): Promise<string> {
		return input;
	}
	protected getCurrentFileLink(): string | null {
		return null;
	}
	protected getCurrentFileName(): string | null {
		return null;
	}
	protected async promptForValue(): Promise<string> {
		return "";
	}
	protected async promptForMathValue(): Promise<string> {
		return "";
	}
	protected getVariableValue(): string {
		return "";
	}
	protected async suggestForValue(): Promise<string> {
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
}

describe("Formatter {{FILE:...}} token", () => {
	it("renders the basename by default", async () => {
		const f = new FileTestFormatter(
			makeApp(["People/Tom.md"]),
			() => `${FILE_PICK_PREFIX}People/Tom.md`,
		);
		expect(await f.run("Hi {{FILE:People}}")).toBe("Hi Tom");
	});

	it("renders a resolved wikilink in link mode (with source path)", async () => {
		const f = new FileTestFormatter(
			makeApp(["People/Tom.md"]),
			() => `${FILE_PICK_PREFIX}People/Tom.md`,
			"Notes/Inbox.md",
		);
		expect(await f.run("{{FILE:People|link}}")).toBe("[[Tom@Notes/Inbox.md]]");
	});

	it("renders the vault path in path mode", async () => {
		const f = new FileTestFormatter(
			makeApp(["People/Tom.md"]),
			() => `${FILE_PICK_PREFIX}People/Tom.md`,
		);
		expect(await f.run("{{FILE:People|path}}")).toBe("People/Tom.md");
	});

	it("prompts once for identical tokens (cached by identity)", async () => {
		const f = new FileTestFormatter(
			makeApp(["People/Tom.md"]),
			() => `${FILE_PICK_PREFIX}People/Tom.md`,
		);
		await f.run("{{FILE:People}} and {{FILE:People}}");
		expect(f.calls).toBe(1);
	});

	it("prompts independently for different modes by default", async () => {
		const f = new FileTestFormatter(
			makeApp(["People/Tom.md"]),
			() => `${FILE_PICK_PREFIX}People/Tom.md`,
		);
		await f.run("{{FILE:People}} {{FILE:People|link}}");
		expect(f.calls).toBe(2);
	});

	it("shares one pick across tokens with the same |name:", async () => {
		const f = new FileTestFormatter(
			makeApp(["People/Tom.md"]),
			() => `${FILE_PICK_PREFIX}People/Tom.md`,
		);
		const out = await f.run(
			"{{FILE:People|name:r}} as {{FILE:People|link|name:r}}",
		);
		expect(f.calls).toBe(1);
		expect(out).toBe("Tom as [[Tom@]]");
	});

	it("treats an optional skip as empty in every mode (never [[]])", async () => {
		const name = new FileTestFormatter(makeApp([]), () => "");
		expect(await name.run("[{{FILE:People|optional}}]")).toBe("[]");
		const link = new FileTestFormatter(makeApp([]), () => "");
		expect(await link.run("[{{FILE:People|link|optional}}]")).toBe("[]");
	});

	it("renders a |custom typed value by name and never resolves it to a file", async () => {
		// Even though "People/Tom.md" exists, a custom-typed value is not resolved.
		const f = new FileTestFormatter(
			makeApp(["People/Tom.md"]),
			() => `${FILE_CUSTOM_PREFIX}Alice`,
		);
		expect(await f.run("{{FILE:People|custom}}")).toBe("Alice");
		const link = new FileTestFormatter(
			makeApp(["People/Tom.md"]),
			() => `${FILE_CUSTOM_PREFIX}Alice`,
		);
		expect(await link.run("{{FILE:People|custom|link}}")).toBe("[[Alice]]");
	});

	it("falls back to [[basename]] when a stored path no longer resolves", async () => {
		const f = new FileTestFormatter(
			makeApp([]), // path does not resolve
			() => `${FILE_PICK_PREFIX}People/Ghost.md`,
		);
		expect(await f.run("{{FILE:People|link}}")).toBe("[[Ghost]]");
	});

	it("prompts independently for tokens that differ only by label", async () => {
		const f = new FileTestFormatter(
			makeApp(["People/Tom.md"]),
			() => `${FILE_PICK_PREFIX}People/Tom.md`,
		);
		await f.run(
			"{{FILE:People|label:Author}} / {{FILE:People|label:Reviewer}}",
		);
		expect(f.calls).toBe(2);
	});

	it("treats an untagged (raw) stored value as literal text — never resolved", async () => {
		// Simulates a one-page-typed custom value or a script-seeded plain string:
		// it must NOT resolve to the real (possibly filtered-out) file.
		const linkF = new FileTestFormatter(makeApp(["People/Tom.md"]), () => "");
		linkF.seed("FILE:folder=People|mode=link", "People/Tom.md");
		// Raw → linked by name, never via generateMarkdownLink on the real file.
		expect(await linkF.run("{{FILE:People|link}}")).toBe("[[People/Tom.md]]");

		const nameF = new FileTestFormatter(makeApp(["People/Tom.md"]), () => "");
		nameF.seed("FILE:folder=People|mode=name", "Archive/Tom.md");
		expect(await nameF.run("{{FILE:People}}")).toBe("Archive/Tom.md");
	});

	it("leaves {{FILENAMECURRENT}} untouched (no FILE_REGEX collision)", async () => {
		const f = new FileTestFormatter(
			makeApp(["People/Tom.md"]),
			() => `${FILE_PICK_PREFIX}People/Tom.md`,
		);
		expect(await f.run("{{FILENAMECURRENT}} {{FILE:People}}")).toBe(
			"{{FILENAMECURRENT}} Tom",
		);
		expect(f.calls).toBe(1);
	});

	it("leaves an empty {{FILE:}} token literal and never prompts", async () => {
		const f = new FileTestFormatter(makeApp([]), () => {
			throw new Error("should not prompt");
		});
		expect(await f.run("a {{FILE:}} b")).toBe("a {{FILE:}} b");
		expect(f.calls).toBe(0);
	});

	it("joins FILE multi-select arrays outside frontmatter property positions", async () => {
		const f = new FileTestFormatter(
			makeApp(["People/Tom.md", "People/Jack.md"]),
			() => [
				`${FILE_PICK_PREFIX}People/Tom.md`,
				`${FILE_PICK_PREFIX}People/Jack.md`,
			],
		);
		expect(await f.run("People: {{FILE:People|multi}}")).toBe(
			"People: Tom,Jack",
		);
	});

	it("collects FILE multi-select arrays as YAML list properties", async () => {
		const f = new FileTestFormatter(
			makeApp(["People/Tom.md", "People/Jack.md"]),
			() => [
				`${FILE_PICK_PREFIX}People/Tom.md`,
				`${FILE_PICK_PREFIX}People/Jack.md`,
			],
		);

		const output = await f.runWithPropertyCollection(
			"---\npeople: {{FILE:People|multi|link}}\n---\n",
		);
		const vars = f.getAndClearTemplatePropertyVars();

		expect(output).toBe("---\npeople: []\n---\n");
		expect(vars.get("people")).toEqual(["[[Tom@]]", "[[Jack@]]"]);
	});
});
