import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TFile } from "obsidian";
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

describe("clipboard copy emits a portable wikilink (audit)", () => {
	beforeEach(() => {
		noticeClass.instances.length = 0;
	});

	afterEach(() => {
		vi.unstubAllGlobals();
		vi.restoreAllMocks();
	});

	// Codex review follow-up: clipboard text has no destination note, so honoring
	// the vault's link-format setting (which can produce relative Markdown links)
	// would generate a link relative to an implicit empty source — wrong once
	// pasted into a note in another folder. Always emit a portable full-path
	// wikilink so the copied link resolves wherever it is pasted.
	it("always emits a portable full-path wikilink (never a source-relative link)", async () => {
		const writeText = vi.fn().mockResolvedValue(undefined);
		vi.stubGlobal("navigator", { clipboard: { writeText } });

		const generateMarkdownLink = vi.fn(
			() => "../wrong/relative/Created%20Note.md",
		);
		// Even if an App with link-format settings exists in the environment, the
		// clipboard path must not consult it (no app argument is passed).
		void generateMarkdownLink;

		await expect(copyFileLinkToClipboard(createFile())).resolves.toBe(true);

		expect(generateMarkdownLink).not.toHaveBeenCalled();
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
