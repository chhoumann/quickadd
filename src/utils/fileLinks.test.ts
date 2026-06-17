import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { App, TFile } from "obsidian";
import { Notice } from "obsidian";
import {
	buildFileLinkText,
	buildPortableFileLinkText,
	copyFileLinkToClipboard,
	writeTextToClipboard,
} from "./fileLinks";

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
});
