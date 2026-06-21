import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { App , TFile } from "obsidian";
import { Notice } from "obsidian";
import { copyFileLinkToClipboard, writeTextToClipboard } from "./fileLinks";
import { log } from "../logger/logManager";

type NoticeTestClass = typeof Notice & {
	instances: Array<{ message: string; timeout?: number }>;
};

const noticeClass = Notice as unknown as NoticeTestClass;

function createFile(): TFile {
	return {
		basename: "Created Note",
		path: "Projects/Created Note.md",
	} as TFile;
}

describe("clipboard copy respects vault link settings (audit)", () => {
	beforeEach(() => {
		noticeClass.instances.length = 0;
	});

	afterEach(() => {
		vi.unstubAllGlobals();
		vi.restoreAllMocks();
	});

	it("uses generateMarkdownLink (honoring link-format settings) when an App is supplied", async () => {
		const writeText = vi.fn().mockResolvedValue(undefined);
		vi.stubGlobal("navigator", { clipboard: { writeText } });

		const generateMarkdownLink = vi.fn(() => "[Created Note](Projects/Created%20Note.md)");
		const app = {
			fileManager: { generateMarkdownLink },
		} as unknown as App;

		await expect(copyFileLinkToClipboard(createFile(), app)).resolves.toBe(true);

		expect(generateMarkdownLink).toHaveBeenCalledTimes(1);
		expect(writeText).toHaveBeenCalledWith(
			"[Created Note](Projects/Created%20Note.md)",
		);
	});

	it("still emits a portable wikilink when no App is supplied (backward compatible)", async () => {
		const writeText = vi.fn().mockResolvedValue(undefined);
		vi.stubGlobal("navigator", { clipboard: { writeText } });

		await expect(copyFileLinkToClipboard(createFile())).resolves.toBe(true);

		expect(writeText).toHaveBeenCalledWith("[[Projects/Created Note]]");
	});
});

describe("writeTextToClipboard does not stack a duplicate notice (audit)", () => {
	afterEach(() => {
		vi.unstubAllGlobals();
		vi.restoreAllMocks();
	});

	it("does not surface its own warning Notice on rejection (caller owns the message)", async () => {
		const logWarning = vi
			.spyOn(log, "logWarning")
			.mockImplementation(() => {});
		const writeText = vi.fn().mockRejectedValue(new Error("denied"));
		vi.stubGlobal("navigator", { clipboard: { writeText } });

		await expect(writeTextToClipboard("[[Created]]")).resolves.toBe(false);

		expect(logWarning).not.toHaveBeenCalled();
	});

	it("does not surface its own warning Notice when the clipboard API is unavailable", async () => {
		const logWarning = vi
			.spyOn(log, "logWarning")
			.mockImplementation(() => {});
		vi.stubGlobal("navigator", {});

		await expect(writeTextToClipboard("[[Created]]")).resolves.toBe(false);

		expect(logWarning).not.toHaveBeenCalled();
	});
});
