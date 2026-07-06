import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { App } from "obsidian";
import { Notice, TFile } from "obsidian";
import {
	appendFileLinkToDestinationFile,
	buildFileLinkText,
	buildPortableFileLinkText,
	copyFileLinkToClipboard,
	getAppendLinkDestinationFile,
	normalizeAppendLinkDestinationPath,
	writeTextToClipboard,
} from "./fileLinks";
import type { AppendLinkOptions, LinkPlacement } from "../types/linkPlacement";

type NoticeTestClass = typeof Notice & {
	instances: Array<{ message: string; timeout?: number }>;
};

const noticeClass = Notice as unknown as NoticeTestClass;

function createApp(linkText = "[[Created Note]]", linktext = "Created Note"): App {
	return {
		fileManager: {
			generateMarkdownLink: vi.fn(() => linkText),
		},
		metadataCache: {
			// Embeds are built from the literal wikilink text, not the formatted link.
			fileToLinktext: vi.fn(() => linktext),
		},
	} as unknown as App;
}

function createFile(): TFile {
	return {
		basename: "Created Note",
		path: "Projects/Created Note.md",
	} as TFile;
}

function makeFile(path: string): TFile {
	const file = new TFile();
	file.path = path;
	file.name = path.split("/").pop() ?? path;
	file.extension = file.name.split(".").pop() ?? "";
	file.basename = file.name.replace(/\.[^.]+$/, "");
	return file;
}

function makeDestinationApp(files: TFile[], contents: Map<string, string>): App {
	const fileMap = new Map(files.map((file) => [file.path, file]));
	return {
		vault: {
			getAbstractFileByPath: vi.fn((path: string) => fileMap.get(path) ?? null),
			process: vi.fn(async (file: TFile, change: (content: string) => string) => {
				contents.set(file.path, change(contents.get(file.path) ?? ""));
			}),
		},
		fileManager: {
			generateMarkdownLink: vi.fn((file: TFile, sourcePath: string) => {
				return `[[${sourcePath}->${file.path}]]`;
			}),
		},
	} as unknown as App;
}

function specifiedLinkOptions(path: string): AppendLinkOptions {
	return {
		enabled: true,
		placement: "newLine",
		requireActiveFile: false,
		linkType: "link",
		destination: { type: "specifiedFile", path },
	};
}

describe("file link helpers", () => {
	beforeEach(() => {
		noticeClass.instances.length = 0;
	});

	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it("builds editor links through Obsidian with an explicit source path", () => {
		const app = createApp("[[Projects/Created Note]]");
		const file = createFile();

		expect(buildFileLinkText(app, file, { sourcePath: "Inbox.md" })).toBe(
			"[[Projects/Created Note]]",
		);
		expect(app.fileManager.generateMarkdownLink).toHaveBeenCalledWith(
			file,
			"Inbox.md",
		);
	});

	it("builds destination-independent clipboard links from vault paths", () => {
		expect(buildPortableFileLinkText(createFile())).toBe(
			"[[Projects/Created Note]]",
		);
		expect(
			buildPortableFileLinkText({
				basename: "Board",
				path: "Canvases/Board.canvas",
			} as TFile),
		).toBe("[[Canvases/Board.canvas]]");
	});

	it("can build embed text for embed-capable editor insertion", () => {
		const app = createApp("[[Created Note]]");
		const file = createFile();

		expect(
			buildFileLinkText(app, file, {
				linkType: "embed",
				placement: "replaceSelection",
				sourcePath: "Inbox.md",
			}),
		).toBe("![[Created Note]]");
		// Embeds are built natively from the literal wikilink text, never by
		// reformatting/decoding a generated Markdown link.
		expect(app.metadataCache.fileToLinktext).toHaveBeenCalledWith(
			file,
			"Inbox.md",
		);
		expect(app.fileManager.generateMarkdownLink).not.toHaveBeenCalled();
	});

	it("builds embed text for every active-note body placement", () => {
		const app = createApp("[[Created Note]]");
		const bodyPlacements: LinkPlacement[] = [
			"replaceSelection",
			"afterSelection",
			"endOfLine",
			"newLine",
		];

		for (const placement of bodyPlacements) {
			expect(
				buildFileLinkText(app, createFile(), {
					linkType: "embed",
					placement,
					sourcePath: "Inbox.md",
				}),
			).toBe("![[Created Note]]");
		}
	});

	it("keeps frontmatter placement link-only even when embed is requested", () => {
		const app = createApp("[[Created Note]]");

		expect(
			buildFileLinkText(app, createFile(), {
				linkType: "embed",
				placement: "inFrontmatter",
				sourcePath: "Inbox.md",
			}),
		).toBe("[[Created Note]]");
	});

	describe("selection-derived aliases", () => {
		function createAliasApp({ useMarkdownLinks = false } = {}): App {
			return {
				fileManager: {
					generateMarkdownLink: vi.fn(
						(
							file: TFile,
							_sourcePath: string,
							_subpath?: string,
							alias?: string,
						) =>
							alias === undefined
								? `[[${file.basename}]]`
								: `[[${file.basename}|${alias}]]`,
					),
				},
				metadataCache: {
					fileToLinktext: vi.fn(() => "Created Note"),
				},
				vault: {
					getConfig: vi.fn((key: string) =>
						key === "useMarkdownLinks" ? useMarkdownLinks : undefined,
					),
				},
			} as unknown as App;
		}

		function generatedAlias(app: App): string | undefined {
			const call = vi.mocked(app.fileManager.generateMarkdownLink).mock
				.calls[0];
			return call.length > 2 ? (call[3] as string | undefined) : undefined;
		}

		function buildWithAlias(app: App, alias: string): string {
			return buildFileLinkText(app, createFile(), {
				sourcePath: "Daily.md",
				linkType: "link",
				placement: "replaceSelection",
				alias,
			});
		}

		it("passes safe selection text through as the alias", () => {
			const app = createAliasApp();
			expect(buildWithAlias(app, "Meeting with Mark")).toBe(
				"[[Created Note|Meeting with Mark]]",
			);
		});

		it("collapses newline runs to a single space and trims", () => {
			const app = createAliasApp();
			buildWithAlias(app, "  first line \r\n\n  second line\n");
			expect(generatedAlias(app)).toBe("first line second line");
		});

		it("omits the alias entirely for empty and whitespace-only selections", () => {
			for (const raw of ["", "   ", "\n\n", " \r\n "]) {
				const app = createAliasApp();
				buildWithAlias(app, raw);
				expect(generatedAlias(app)).toBeUndefined();
				expect(app.fileManager.generateMarkdownLink).toHaveBeenCalledWith(
					createFile(),
					"Daily.md",
				);
			}
		});

		it("keeps single brackets and pipes in wiki aliases (safe per Obsidian's parser)", () => {
			for (const safe of ["array[0] end", "a] b", "open [ bracket", "a|b"]) {
				const app = createAliasApp();
				buildWithAlias(app, safe);
				expect(generatedAlias(app)).toBe(safe);
			}
		});

		it("drops unrepresentable wiki aliases instead of mutating the text", () => {
			// "]]" terminates the wikilink early; "[[" starts a nested link that
			// hijacks the outer target; a trailing "]" forms "]]" with the closer.
			for (const hostile of [
				"a]]b",
				"see [[Other]] ref",
				"array[0]",
				"trail ]",
			]) {
				const app = createAliasApp();
				buildWithAlias(app, hostile);
				expect(generatedAlias(app)).toBeUndefined();
			}
		});

		it("escapes backslashes and brackets for markdown-link vaults", () => {
			const cases: Array<[string, string]> = [
				["a [x] b", "a \\[x\\] b"],
				["C:\\path\\", "C:\\\\path\\\\"],
				["a\\]b", "a\\\\\\]b"],
				["array[0]", "array\\[0\\]"],
			];
			for (const [raw, escaped] of cases) {
				const app = createAliasApp({ useMarkdownLinks: true });
				buildWithAlias(app, raw);
				expect(generatedAlias(app)).toBe(escaped);
			}
		});

		it("ignores the alias for embeds", () => {
			const app = createAliasApp();
			const text = buildFileLinkText(app, createFile(), {
				sourcePath: "Daily.md",
				linkType: "embed",
				placement: "replaceSelection",
				alias: "Meeting with Mark",
			});
			expect(text).toBe("![[Created Note]]");
			expect(app.fileManager.generateMarkdownLink).not.toHaveBeenCalled();
		});
	});

	it("returns false when clipboard writes are unavailable", async () => {
		vi.stubGlobal("navigator", {});

		await expect(writeTextToClipboard("[[Created Note]]")).resolves.toBe(false);
	});

	it("copies file links and reports success", async () => {
		const writeText = vi.fn().mockResolvedValue(undefined);
		vi.stubGlobal("navigator", { clipboard: { writeText } });

		await expect(
			copyFileLinkToClipboard(createFile()),
		).resolves.toBe(true);

		expect(writeText).toHaveBeenCalledWith("[[Projects/Created Note]]");
		expect(noticeClass.instances.at(-1)?.message).toContain(
			"Copied link to 'Created Note'",
		);
	});

	it("treats clipboard write rejection as non-fatal", async () => {
		const writeText = vi.fn().mockRejectedValue(new Error("denied"));
		vi.stubGlobal("navigator", { clipboard: { writeText } });

		await expect(
			copyFileLinkToClipboard(createFile()),
		).resolves.toBe(false);

		expect(noticeClass.instances.at(-1)?.message).toContain(
			"could not copy its link",
		);
	});

	it("normalizes note paths for specified append-link destinations", () => {
		expect(normalizeAppendLinkDestinationPath("/Indexes/MOC")).toBe(
			"Indexes/MOC.md",
		);
		expect(normalizeAppendLinkDestinationPath("Indexes/MOC.md")).toBe(
			"Indexes/MOC.md",
		);
		expect(normalizeAppendLinkDestinationPath("Daily/2026.06.18")).toBe(
			"Daily/2026.06.18.md",
		);
		expect(normalizeAppendLinkDestinationPath("Boards/MOC.canvas")).toBe(
			"Boards/MOC.canvas.md",
		);
	});

	it("resolves only existing Markdown files as append-link destinations", () => {
		const contents = new Map<string, string>();
		const index = makeFile("Indexes/MOC.md");
		const dotted = makeFile("Daily/2026.06.18.md");
		const canvas = makeFile("Indexes/MOC.canvas");
		const app = makeDestinationApp([index, dotted, canvas], contents);

		expect(
			getAppendLinkDestinationFile(app, {
				type: "specifiedFile",
				path: "Indexes/MOC",
			}),
		).toBe(index);
		expect(
			getAppendLinkDestinationFile(app, {
				type: "specifiedFile",
				path: "Daily/2026.06.18",
			}),
		).toBe(dotted);
		expect(
			getAppendLinkDestinationFile(app, {
				type: "specifiedFile",
				path: "Indexes/MOC.canvas",
			}),
		).toBeNull();
		expect(
			getAppendLinkDestinationFile(app, {
				type: "activeFile",
			}),
		).toBeNull();
	});

	it("appends the generated link to the destination file with that file as source", async () => {
		const contents = new Map([["Indexes/MOC.md", "# Index\n"]]);
		const index = makeFile("Indexes/MOC.md");
		const created = makeFile("Notes/New.md");
		const app = makeDestinationApp([index, created], contents);

		await appendFileLinkToDestinationFile(
			app,
			created,
			specifiedLinkOptions("Indexes/MOC"),
		);

		expect(app.fileManager.generateMarkdownLink).toHaveBeenCalledWith(
			created,
			"Indexes/MOC.md",
		);
		expect(contents.get("Indexes/MOC.md")).toBe(
			"# Index\n[[Indexes/MOC.md->Notes/New.md]]",
		);
	});

	it("inserts a separating newline when the destination has no trailing newline", async () => {
		const contents = new Map([["Indexes/MOC.md", "# Index"]]);
		const index = makeFile("Indexes/MOC.md");
		const created = makeFile("Notes/New.md");
		const app = makeDestinationApp([index, created], contents);

		await appendFileLinkToDestinationFile(
			app,
			created,
			specifiedLinkOptions("Indexes/MOC.md"),
		);

		expect(contents.get("Indexes/MOC.md")).toBe(
			"# Index\n[[Indexes/MOC.md->Notes/New.md]]",
		);
	});

	it("throws when the destination file is missing", async () => {
		const contents = new Map<string, string>();
		const created = makeFile("Notes/New.md");
		const app = makeDestinationApp([created], contents);

		await expect(
			appendFileLinkToDestinationFile(
				app,
				created,
				specifiedLinkOptions("Indexes/Missing.md"),
			),
		).rejects.toThrow("Append link target file not found");
	});
});

describe("prepareLinkAlias whitespace handling (via buildFileLinkText)", () => {
	function createWikiApp(): App {
		return {
			fileManager: {
				generateMarkdownLink: vi.fn(
					(
						file: TFile,
						_sourcePath: string,
						_subpath?: string,
						alias?: string,
					) =>
						alias === undefined
							? `[[${file.basename}]]`
							: `[[${file.basename}|${alias}]]`,
				),
			},
			metadataCache: { fileToLinktext: vi.fn(() => "Created Note") },
			vault: { getConfig: vi.fn(() => false) },
		} as unknown as App;
	}

	function aliasFor(raw: string): string {
		const app = createWikiApp();
		const file = {
			basename: "Created Note",
			path: "Projects/Created Note.md",
		} as TFile;
		return buildFileLinkText(app, file, {
			sourcePath: "Daily.md",
			linkType: "link",
			alias: raw,
		});
	}

	it("collapses CRLF/CR/LF runs with surrounding spaces to one space", () => {
		expect(aliasFor("a  \r\n\t b")).toBe("[[Created Note|a b]]");
		expect(aliasFor("a\rb\nc")).toBe("[[Created Note|a b c]]");
	});

	it("keeps interior horizontal whitespace runs intact", () => {
		expect(aliasFor("a  \t  b")).toBe("[[Created Note|a  \t  b]]");
	});

	it(
		"handles a long newline-free horizontal-whitespace run in linear time",
		() => {
			// Opener-flood ReDoS shape (#1444/#1455/#1462): a long run of spaces
			// with no newline must not backtrack quadratically.
			const input = `a${" ".repeat(200_000)}b`;
			const start = performance.now();
			const result = aliasFor(input);
			const elapsed = performance.now() - start;

			expect(result).toBe(`[[Created Note|${input}]]`);
			expect(elapsed).toBeLessThan(1_000);
		},
		20_000,
	);
});
