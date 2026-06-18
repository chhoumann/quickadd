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
import type { AppendLinkOptions } from "../types/linkPlacement";

type NoticeTestClass = typeof Notice & {
	instances: Array<{ message: string; timeout?: number }>;
};

const noticeClass = Notice as unknown as NoticeTestClass;

function createApp(linkText = "[[Created Note]]"): App {
	return {
		fileManager: {
			generateMarkdownLink: vi.fn(() => linkText),
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

		expect(
			buildFileLinkText(app, createFile(), {
				linkType: "embed",
				placement: "replaceSelection",
				sourcePath: "Inbox.md",
			}),
		).toBe("![[Created Note]]");
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
