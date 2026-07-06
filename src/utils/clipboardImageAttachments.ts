import type { App, TFile } from "obsidian";
import { escapesVaultBoundary } from "./vaultPathBoundary";

/**
 * Clipboard image MIME types QuickAdd accepts, mapped to the file extension the
 * saved attachment gets. Shared by the Capture `{{CLIPBOARD}}` image fallback
 * (PR #1393) and direct image paste into prompt inputs (issue #1484) so both
 * surfaces accept exactly the same formats.
 */
// Null prototype so a hostile MIME like "constructor" can never hit an
// inherited Object.prototype member in the index lookups below.
export const IMAGE_CLIPBOARD_MIME_EXTENSIONS: Record<string, string> =
	Object.assign(Object.create(null) as Record<string, string>, {
		"image/png": "png",
		"image/jpeg": "jpg",
		"image/jpg": "jpg",
		"image/gif": "gif",
		"image/webp": "webp",
		"image/svg+xml": "svg",
	});

export function formatClipboardAttachmentTimestamp(date: Date): string {
	const pad = (value: number) => String(value).padStart(2, "0");
	return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(
		date.getDate(),
	)} ${pad(date.getHours())}.${pad(date.getMinutes())}.${pad(
		date.getSeconds(),
	)}`;
}

/**
 * Saves clipboard image bytes as a vault attachment and returns the created
 * file. Link generation is a separate step ({@link buildImageEmbedLink}) so a
 * caller can record the created file for rollback/tracking BEFORE anything
 * that might still fail - a file created but untracked is an orphan no
 * cleanup can find.
 *
 * Placement is delegated to `fileManager.getAvailablePathForAttachment`, which
 * honors the user's attachment-folder setting and dedupes name collisions
 * against files already in the vault. Callers saving MULTIPLE images must
 * therefore save strictly sequentially: the dedupe only sees files whose
 * `createBinary` has landed, so two same-second saves with in-flight writes
 * would resolve the same path and the second would throw.
 */
export async function saveClipboardImageToVault(
	app: App,
	data: ArrayBuffer,
	mimeType: string,
	sourcePath: string,
): Promise<TFile> {
	const extension = IMAGE_CLIPBOARD_MIME_EXTENSIONS[mimeType];
	if (!extension) {
		throw new Error(`Unsupported clipboard image type: ${mimeType}`);
	}

	const filename = `Clipboard image ${formatClipboardAttachmentTimestamp(
		new Date(),
	)}.${extension}`;
	const attachmentPath = await app.fileManager.getAvailablePathForAttachment(
		filename,
		sourcePath || undefined,
	);
	// The attachment path comes from user-configurable settings; refuse any
	// resolution that would write outside the vault (defense in depth at the
	// write sink, mirroring the repo's other vault-boundary guards).
	if (escapesVaultBoundary(attachmentPath)) {
		throw new Error(
			`Refusing to save clipboard image outside the vault: '${attachmentPath}'`,
		);
	}
	return app.vault.createBinary(attachmentPath, data);
}

/**
 * Builds the embed link for a saved attachment, forcing the `!` prefix and
 * honoring the user's wikilink/markdown preference.
 *
 * `sourcePath` is the note the link will live in when known (capture
 * destination), or "" when the destination is not yet resolved - "" makes
 * `generateMarkdownLink` emit a vault-root path that resolves from anywhere,
 * which is safer than guessing (e.g. the active file) and generating a
 * relative link that breaks from the real destination.
 */
export function buildImageEmbedLink(
	app: App,
	file: TFile,
	sourcePath: string,
): string {
	const link = app.fileManager.generateMarkdownLink(file, sourcePath);
	return link.startsWith("!") ? link : `!${link}`;
}
