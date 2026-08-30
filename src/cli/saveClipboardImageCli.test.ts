import { describe, expect, it, vi } from "vitest";
import type { TFile } from "obsidian";
import type QuickAdd from "../main";
import {
	SAVE_CLIPBOARD_IMAGE_COMMAND,
	saveClipboardImageHandler,
} from "./saveClipboardImageCli";

vi.mock("../utils/clipboardImageAttachments", () => ({
	saveClipboardImageToVault: vi.fn(),
}));

import { saveClipboardImageToVault } from "../utils/clipboardImageAttachments";

const saveMock = vi.mocked(saveClipboardImageToVault);

function pluginWithSetting(nameAfterNoteTitle: boolean): QuickAdd {
	return {
		app: {},
		settings: { namePastedImagesAfterNoteTitle: nameAfterNoteTitle },
	} as unknown as QuickAdd;
}

describe("saveClipboardImageHandler", () => {
	it("saves a png named after the destination when the flag is true", async () => {
		saveMock.mockResolvedValue({
			path: "attachments/Meeting notes.png",
			name: "Meeting notes.png",
		} as TFile);

		const payload = JSON.parse(
			await saveClipboardImageHandler(pluginWithSetting(false), {
				sourcePath: "Meetings/Meeting notes.md",
				nameAfterNoteTitle: "true",
			}),
		);

		expect(payload).toMatchObject({
			ok: true,
			command: SAVE_CLIPBOARD_IMAGE_COMMAND,
			path: "attachments/Meeting notes.png",
			name: "Meeting notes.png",
			sourcePath: "Meetings/Meeting notes.md",
			nameAfterNoteTitle: true,
		});
		expect(saveMock).toHaveBeenCalledWith(
			expect.anything(),
			expect.any(ArrayBuffer),
			"image/png",
			"Meetings/Meeting notes.md",
			{ nameAfterNoteTitle: true },
		);
	});

	it("omits the override when the flag is absent so the setting applies", async () => {
		saveMock.mockResolvedValue({
			path: "attachments/Clipboard image 2026-08-29 21.40.00.png",
			name: "Clipboard image 2026-08-29 21.40.00.png",
		} as TFile);

		const payload = JSON.parse(
			await saveClipboardImageHandler(pluginWithSetting(false), {
				sourcePath: "Meetings/Meeting notes.md",
			}),
		);

		expect(payload.ok).toBe(true);
		expect(payload.nameAfterNoteTitle).toBe(false);
		expect(saveMock).toHaveBeenCalledWith(
			expect.anything(),
			expect.any(ArrayBuffer),
			"image/png",
			"Meetings/Meeting notes.md",
			undefined,
		);
	});

	it("rejects an invalid nameAfterNoteTitle value", async () => {
		const payload = JSON.parse(
			await saveClipboardImageHandler(pluginWithSetting(false), {
				nameAfterNoteTitle: "maybe",
			}),
		);

		expect(payload.ok).toBe(false);
		expect(payload.error).toMatch(/Invalid nameAfterNoteTitle/);
	});
});
