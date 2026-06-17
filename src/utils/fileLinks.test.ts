import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { App, TFile } from "obsidian";
import { Notice } from "obsidian";
import {
	buildFileLinkText,
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

	it("builds a destination-agnostic link by default", () => {
		const app = createApp("[[Projects/Created Note]]");
		const file = createFile();

		expect(buildFileLinkText(app, file)).toBe("[[Projects/Created Note]]");
		expect(app.fileManager.generateMarkdownLink).toHaveBeenCalledWith(file, "");
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
			copyFileLinkToClipboard(createApp(), createFile()),
		).resolves.toBe(true);

		expect(writeText).toHaveBeenCalledWith("[[Created Note]]");
		expect(noticeClass.instances.at(-1)?.message).toContain(
			"Copied link to 'Created Note'",
		);
	});

	it("treats clipboard write rejection as non-fatal", async () => {
		const writeText = vi.fn().mockRejectedValue(new Error("denied"));
		vi.stubGlobal("navigator", { clipboard: { writeText } });

		await expect(
			copyFileLinkToClipboard(createApp(), createFile()),
		).resolves.toBe(false);

		expect(noticeClass.instances.at(-1)?.message).toContain(
			"could not copy its link",
		);
	});
});
