import { describe, expect, it, vi } from "vitest";
import type { App, TFile } from "obsidian";
import {
	IMAGE_CLIPBOARD_MIME_EXTENSIONS,
	buildImageEmbedLink,
	formatClipboardAttachmentTimestamp,
	saveClipboardImageToVault,
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
