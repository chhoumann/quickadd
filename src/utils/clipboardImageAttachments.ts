import type { App, TFile } from "obsidian";
import {
	INVALID_FOLDER_CHARS_REGEX,
	isReservedWindowsDeviceName,
} from "./pathValidation";
import { escapesVaultBoundary } from "./vaultPathBoundary";

/**
 * Clipboard image MIME types QuickAdd accepts, mapped to the file extension the
 * saved attachment gets. Shared by the Capture `{{CLIPBOARD}}` image fallback
 * (PR #1393) and direct image paste into prompt inputs (issue #1484) so both
 * surfaces accept exactly the same formats.
 */
export const IMAGE_CLIPBOARD_MIME_EXTENSIONS: Record<string, string> =
	Object.assign(Object.create(null) as Record<string, string>, {
		"image/png": "png",
		"image/jpeg": "jpg",
		"image/jpg": "jpg",
		"image/gif": "gif",
		"image/webp": "webp",
		"image/svg+xml": "svg",
	});

export function isSupportedImageMime(type: string): boolean {
	return Object.hasOwn(IMAGE_CLIPBOARD_MIME_EXTENSIONS, type);
}

export function isSupportedImageExtension(extension: string): boolean {
	const normalizedExtension = extension.toLowerCase();
	return (
		normalizedExtension === "jpeg" ||
		Object.values(IMAGE_CLIPBOARD_MIME_EXTENSIONS).includes(normalizedExtension)
	);
}

export function formatClipboardAttachmentTimestamp(date: Date): string {
	const pad = (value: number) => String(value).padStart(2, "0");
	return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(
		date.getDate(),
	)} ${pad(date.getHours())}.${pad(date.getMinutes())}.${pad(
		date.getSeconds(),
	)}`;
}

export function clipboardImageFilename(mimeType: string, now: Date): string {
	if (!isSupportedImageMime(mimeType)) {
		throw new Error(`Unsupported clipboard image type: ${mimeType}`);
	}

	return `Clipboard image ${formatClipboardAttachmentTimestamp(now)}.${IMAGE_CLIPBOARD_MIME_EXTENSIONS[mimeType]}`;
}

export function droppedImageFilename(
	originalName: string,
	mimeType: string,
	now: Date,
): string {
	if (!isSupportedImageMime(mimeType)) {
		throw new Error(`Unsupported image type: ${mimeType}`);
	}

	const basename = originalName.split(/[\\/]/u).at(-1) ?? "";
	const extensionIndex = basename.lastIndexOf(".");
	const stem =
		extensionIndex >= 0 ? basename.slice(0, extensionIndex) : basename;
	const hasUsableStem =
		stem.length > 0 &&
		stem !== "." &&
		stem !== ".." &&
		!isReservedWindowsDeviceName(stem) &&
		!INVALID_FOLDER_CHARS_REGEX.test(stem);

	if (!hasUsableStem) {
		return clipboardImageFilename(mimeType, now);
	}

	return `${stem}.${IMAGE_CLIPBOARD_MIME_EXTENSIONS[mimeType]}`;
}

/**
 * Saves image bytes as a vault attachment and returns the created file.
 *
 * Placement is delegated to `fileManager.getAvailablePathForAttachment`, which
 * honors the user's attachment-folder setting and dedupes name collisions
 * against files already in the vault. Callers saving MULTIPLE images must
 * therefore save strictly sequentially: the dedupe only sees files whose
 * `createBinary` has landed, so two same-second saves with in-flight writes
 * would resolve the same path and the second would throw.
 */
export async function saveImageBytesToVault(
	app: App,
	data: ArrayBuffer,
	mimeType: string,
	sourcePath: string,
	filename: string,
): Promise<TFile> {
	if (!isSupportedImageMime(mimeType)) {
		throw new Error(`Unsupported image type: ${mimeType}`);
	}

	const attachmentPath = await app.fileManager.getAvailablePathForAttachment(
		filename,
		sourcePath || undefined,
	);
	if (escapesVaultBoundary(attachmentPath)) {
		throw new Error(
			`Refusing to save image outside the vault: '${attachmentPath}'`,
		);
	}
	return app.vault.createBinary(attachmentPath, data);
}

export async function saveClipboardImageToVault(
	app: App,
	data: ArrayBuffer,
	mimeType: string,
	sourcePath: string,
): Promise<TFile> {
	return saveImageBytesToVault(
		app,
		data,
		mimeType,
		sourcePath,
		clipboardImageFilename(mimeType, new Date()),
	);
}

/**
 * Builds the embed link for a saved attachment, forcing the `!` prefix and
 * honoring the user's wikilink/markdown preference.
 *
 * `sourcePath` is the note the link will live in when known (capture
 * destination), or "" when the destination is not yet resolved. "" makes
 * `generateMarkdownLink` emit a vault-root path that resolves from anywhere.
 */
export function buildImageEmbedLink(
	app: App,
	file: TFile,
	sourcePath: string,
): string {
	const link = app.fileManager.generateMarkdownLink(file, sourcePath);
	return link.startsWith("!") ? link : `!${link}`;
}
