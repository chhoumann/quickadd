import { describe, expect, it, vi } from "vitest";
import type { App, TFile } from "obsidian";
import {
	IMAGE_CLIPBOARD_MIME_EXTENSIONS,
	buildImageEmbedLink,
	clipboardImageAttachmentFileName,
	clipboardImageFilename,
	droppedImageFilename,
	droppedImageStem,
	formatClipboardAttachmentTimestamp,
	isSupportedImageExtension,
	isSupportedImageMime,
	sanitizeClipboardImageStem,
	saveClipboardImageToVault,
	saveImageBytesToVault,
} from "./clipboardImageAttachments";

function makeApp(overrides?: {
	getAvailablePathForAttachment?: (
		filename: string,
		sourcePath?: string,
	) => Promise<string>;
	generateMarkdownLink?: (file: TFile, sourcePath: string) => string;
}) {
	const createBinary = vi.fn(
		async (path: string, _data: ArrayBuffer) => ({ path }) as TFile,
	);
	const getAvailablePathForAttachment = vi.fn(
		overrides?.getAvailablePathForAttachment ??
			(async (filename: string) => `attachments/${filename}`),
	);
	const generateMarkdownLink = vi.fn(
		overrides?.generateMarkdownLink ??
			((file: TFile) => `![[${file.path}]]`),
	);
	const app = {
		vault: { createBinary },
		fileManager: { getAvailablePathForAttachment, generateMarkdownLink },
	} as unknown as App;
	return { app, createBinary, getAvailablePathForAttachment, generateMarkdownLink };
}

const data = new ArrayBuffer(8);

describe("saveClipboardImageToVault", () => {
	it("saves via the attachment-folder API with the destination as context", async () => {
		const { app, createBinary, getAvailablePathForAttachment } = makeApp();

		const file = await saveClipboardImageToVault(
			app,
			data,
			"image/png",
			"Journal/inbox.md",
		);

		expect(getAvailablePathForAttachment).toHaveBeenCalledWith(
			expect.stringMatching(/^Clipboard image .*\.png$/),
			"Journal/inbox.md",
		);
		expect(createBinary).toHaveBeenCalledWith(
			expect.stringMatching(/^attachments\/Clipboard image .*\.png$/),
			data,
		);
		expect(file.path).toMatch(/^attachments\/Clipboard image .*\.png$/);
	});

	it("names the file after the destination note when asked", async () => {
		const { app, getAvailablePathForAttachment } = makeApp();

		await saveClipboardImageToVault(
			app,
			data,
			"image/png",
			"Meetings/Meeting notes.md",
			{ nameAfterNoteTitle: true },
		);

		expect(getAvailablePathForAttachment).toHaveBeenCalledWith(
			"Meeting notes.png",
			"Meetings/Meeting notes.md",
		);
	});

	it("keeps the timestamp name when destination-title naming is on but the path is empty", async () => {
		const { app, getAvailablePathForAttachment } = makeApp();

		await saveClipboardImageToVault(app, data, "image/png", "", {
			nameAfterNoteTitle: true,
			now: new Date(2026, 7, 29, 21, 40, 0),
		});

		expect(getAvailablePathForAttachment).toHaveBeenCalledWith(
			"Clipboard image 2026-08-29 21.40.00.png",
			undefined,
		);
	});

	it("passes undefined source context when the destination is unknown", async () => {
		const { app, getAvailablePathForAttachment } = makeApp();

		await saveClipboardImageToVault(app, data, "image/png", "");

		expect(getAvailablePathForAttachment).toHaveBeenCalledWith(
			expect.any(String),
			undefined,
		);
	});

	it("rejects unsupported MIME types without touching the vault", async () => {
		const { app, createBinary } = makeApp();

		await expect(
			saveClipboardImageToVault(app, data, "application/pdf", ""),
		).rejects.toThrow(/Unsupported clipboard image type/);
		expect(createBinary).not.toHaveBeenCalled();
	});

	it.each(["../escape.png", "/tmp/x.png", "C:\\evil.png"])(
		"refuses to write outside the vault (%s)",
		async (badPath) => {
			const { app, createBinary } = makeApp({
				getAvailablePathForAttachment: async () => badPath,
			});

			await expect(
				saveClipboardImageToVault(app, data, "image/png", ""),
			).rejects.toThrow(/outside the vault/);
			expect(createBinary).not.toHaveBeenCalled();
		},
	);

	it("uses the extension from the MIME map", () => {
		expect(IMAGE_CLIPBOARD_MIME_EXTENSIONS["image/webp"]).toBe("webp");
		expect(IMAGE_CLIPBOARD_MIME_EXTENSIONS["image/svg+xml"]).toBe("svg");
	});
});

describe("image attachment naming", () => {
	const now = new Date(2026, 6, 6, 9, 5, 3);

	it("recognizes MIME types without inherited object properties", () => {
		expect(isSupportedImageMime("image/png")).toBe(true);
		expect(isSupportedImageMime("constructor")).toBe(false);
	});

	it("derives supported extensions from the MIME map and accepts jpeg", () => {
		expect(isSupportedImageExtension("png")).toBe(true);
		expect(isSupportedImageExtension("jpeg")).toBe(true);
		expect(isSupportedImageExtension("pdf")).toBe(false);
	});

	it("builds the shipped clipboard timestamp filename", () => {
		expect(clipboardImageFilename("image/png", now)).toBe(
			"Clipboard image 2026-07-06 09.05.03.png",
		);
		expect(() => clipboardImageFilename("application/pdf", now)).toThrow(
			/Unsupported clipboard image type/,
		);
	});

	it("keeps a usable dropped basename and normalizes its extension", () => {
		expect(droppedImageStem("holiday.jpeg")).toBe("holiday");
		expect(droppedImageFilename("holiday.jpeg", "image/jpeg", now)).toBe(
			"holiday.jpg",
		);
	});

	it.each([
		["photos/summer.png", "summer.png"],
		["C:\\Users\\me\\winter.png", "winter.png"],
	])("strips path segments from %s", (originalName, expected) => {
		expect(droppedImageFilename(originalName, "image/png", now)).toBe(expected);
	});

	it.each([
		"",
		".",
		"..",
		"CON.png",
		"CON.backup.png",
		"bad:name.png",
		"report:final.png",
		".hidden.png",
		"photo..png",
		"photo .png",
		`photo${String.fromCharCode(0x01)}.png`,
	])("falls back to clipboard naming for %s", (originalName) => {
		expect(droppedImageFilename(originalName, "image/png", now)).toBe(
			"Clipboard image 2026-07-06 09.05.03.png",
		);
		expect(droppedImageStem(originalName)).toBeNull();
	});

	it("uses the MIME extension instead of the dropped extension", () => {
		expect(droppedImageFilename("portrait.jpeg", "image/png", now)).toBe(
			"portrait.png",
		);
	});

	it("rejects unsupported MIME types", () => {
		expect(() =>
			droppedImageFilename("portrait.png", "application/pdf", now),
		).toThrow(/Unsupported image type/);
	});
});

describe("saveImageBytesToVault", () => {
	it("rejects inherited object-property MIME names at the write sink", async () => {
		const { app, createBinary, getAvailablePathForAttachment } = makeApp();

		await expect(
			saveImageBytesToVault(
				app,
				data,
				"constructor",
				"",
				"portrait.png",
			),
		).rejects.toThrow(/Unsupported image type/);
		expect(getAvailablePathForAttachment).not.toHaveBeenCalled();
		expect(createBinary).not.toHaveBeenCalled();
	});
});

describe("buildImageEmbedLink", () => {
	it("uses '' source so the link resolves from any destination", () => {
		const { app, generateMarkdownLink } = makeApp();

		const link = buildImageEmbedLink(app, { path: "a.png" } as TFile, "");

		expect(generateMarkdownLink).toHaveBeenCalledWith(expect.anything(), "");
		expect(link).toBe("![[a.png]]");
	});

	it("forces the embed prefix when the user's link format lacks it", () => {
		const { app } = makeApp({
			generateMarkdownLink: (file) => `[[${file.path}]]`,
		});

		const link = buildImageEmbedLink(app, { path: "a.jpg" } as TFile, "");

		expect(link.startsWith("![[")).toBe(true);
	});
});

describe("formatClipboardAttachmentTimestamp", () => {
	it("matches the shipped 'YYYY-MM-DD HH.mm.ss' convention", () => {
		const stamp = formatClipboardAttachmentTimestamp(
			new Date(2026, 6, 6, 9, 5, 3),
		);
		expect(stamp).toBe("2026-07-06 09.05.03");
	});
});

describe("clipboardImageAttachmentFileName", () => {
	const now = new Date(2026, 7, 29, 21, 40, 0);

	it("uses the timestamp name when destination-title naming is off", () => {
		expect(
			clipboardImageAttachmentFileName({
				extension: "png",
				sourcePath: "Meetings/Meeting notes.md",
				now,
				nameAfterNoteTitle: false,
			}),
		).toBe("Clipboard image 2026-08-29 21.40.00.png");
	});

	it("uses the destination basename when destination-title naming is on", () => {
		expect(
			clipboardImageAttachmentFileName({
				extension: "png",
				sourcePath: "Meetings/Meeting notes.md",
				now,
				nameAfterNoteTitle: true,
			}),
		).toBe("Meeting notes.png");
	});

	it("falls back to the timestamp when the stem sanitizes to empty", () => {
		expect(
			clipboardImageAttachmentFileName({
				extension: "png",
				sourcePath: "???.md",
				now,
				nameAfterNoteTitle: true,
			}),
		).toBe("Clipboard image 2026-08-29 21.40.00.png");
	});

	it.each(["Journal/CON.md", "Journal/.hidden.md"])(
		"falls back to the timestamp when the destination title is not portable (%s)",
		(sourcePath) => {
			expect(
				clipboardImageAttachmentFileName({
					extension: "png",
					sourcePath,
					now,
					nameAfterNoteTitle: true,
				}),
			).toBe("Clipboard image 2026-08-29 21.40.00.png");
		},
	);
});

describe("sanitizeClipboardImageStem", () => {
	it("strips path separators and Windows-illegal characters", () => {
		expect(sanitizeClipboardImageStem('a/b:c*d?e"f<g>h|i')).toBe("abcdefghi");
	});
});
