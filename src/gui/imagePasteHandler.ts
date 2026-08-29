import type { App, TAbstractFile, TFile } from "obsidian";
import { Notice } from "obsidian";
import { log } from "../logger/logManager";
import {
	IMAGE_CLIPBOARD_MIME_EXTENSIONS,
	buildImageEmbedLink,
	clipboardImageFilename,
	droppedImageFilename,
	isSupportedImageExtension,
	isSupportedImageMime,
	saveImageBytesToVault,
} from "../utils/clipboardImageAttachments";
import { escapesVaultBoundary } from "../utils/vaultPathBoundary";

export type PromptImage =
	| {
			origin: "bytes";
			file: File;
			mimeType: string;
			naming:
				| { kind: "clipboard-stamp" }
				| { kind: "original-stem"; stem: string };
	  }
	| { origin: "vault"; file: TFile };

export type TransferDecision =
	| { kind: "stand-down" }
	| { kind: "take"; images: PromptImage[] };

export type ImageIntakeChannel = "paste" | "drop";

export interface ImagePasteOptions {
	/**
	 * Note path the inserted link will live in when known (capture
	 * destination). "" (default) resolves attachment placement against the
	 * vault root and makes the link a vault-root path that resolves from any
	 * note - never guess (e.g. the active file): a wrong guess generates
	 * relative links that break from the real destination.
	 */
	sourcePath?: string;
}

export interface ImagePasteHandle {
	/** True while an image save is in flight. */
	isBusy(): boolean;
	/** Resolves once no image save is in flight (immediately when idle). */
	whenIdle(): Promise<void>;
	/** Removes all listeners; a still-running save keeps its file but skips the text insertion. */
	detach(): void;
}

/**
 * Lets an input/textarea accept pasted or dropped images. Paste leaves
 * non-empty clipboard text to the browser. Drop prefers image files because
 * file-manager drags include the filesystem path as text.
 *
 * Attach only to inputs whose value flows into note content as free text.
 */
export function attachImagePasteHandler(
	app: App,
	inputEl: HTMLInputElement | HTMLTextAreaElement,
	options: ImagePasteOptions = {},
): ImagePasteHandle {
	const sourcePath = options.sourcePath ?? "";
	let pendingSave: Promise<void> | null = null;
	let detached = false;
	let composing = false;

	const onCompositionStart = () => {
		composing = true;
	};
	const onCompositionEnd = () => {
		composing = false;
	};

	const acceptDecision = (
		channel: ImageIntakeChannel,
		event: ClipboardEvent | DragEvent,
		decision: TransferDecision,
		now: Date,
	): void => {
		switch (decision.kind) {
			case "stand-down":
				return;
			case "take":
				event.preventDefault();
				if (pendingSave) {
					new Notice(
						channel === "paste"
							? "QuickAdd: an image is still being saved — paste again in a moment."
							: "QuickAdd: an image is still being saved — drop again in a moment.",
					);
					return;
				}
				pendingSave = beginIntake(decision.images, now).finally(() => {
					pendingSave = null;
				});
				return;
			default:
				return assertNever(decision);
		}
	};

	const onPaste = (event: ClipboardEvent) => {
		const data = event.clipboardData;
		if (!data) return;
		if (composing) return;
		const now = new Date();
		acceptDecision("paste", event, decideTransfer("paste", data, app, now), now);
	};

	const onDragEnterOrOver = (event: DragEvent) => {
		if (composing) return;
		const data = event.dataTransfer;
		if (!data || !transferMayCarryFiles(data)) return;
		event.preventDefault();
		inputEl.classList.add("qa-image-drop-target");
	};

	const clearDropTarget = () => {
		inputEl.classList.remove("qa-image-drop-target");
	};

	const onDrop = (event: DragEvent) => {
		clearDropTarget();
		if (composing) return;
		const data = event.dataTransfer;
		if (!data) return;
		const now = new Date();
		acceptDecision("drop", event, decideTransfer("drop", data, app, now), now);
	};

	async function beginIntake(
		images: PromptImage[],
		now: Date,
	): Promise<void> {
		const wasReadOnly = inputEl.readOnly;
		inputEl.readOnly = true;
		inputEl.setAttribute("aria-busy", "true");
		inputEl.classList.add("qa-image-paste-busy");

		const links: string[] = [];
		try {
			for (const image of images) {
				let file: TFile;
				switch (image.origin) {
					case "vault":
						file = image.file;
						break;
					case "bytes": {
						const data = await image.file.arrayBuffer();
						const filename = promptImageFilename(image, now);
						file = await enqueueVaultSave(() =>
							saveImageBytesToVault(
								app,
								data,
								image.mimeType,
								sourcePath,
								filename,
							),
						);
						break;
					}
					default:
						return assertNever(image);
				}
				links.push(buildImageEmbedLink(app, file, sourcePath));
			}
		} catch (error) {
			log.logError(
				`Failed to save pasted image: ${error instanceof Error ? error.message : String(error)}`,
			);
			new Notice("QuickAdd: failed to save pasted image.");
		} finally {
			inputEl.readOnly = wasReadOnly;
			inputEl.removeAttribute("aria-busy");
			inputEl.classList.remove("qa-image-paste-busy");
		}

		if (links.length === 0 || detached) return;
		try {
			insertAtSelection(
				inputEl,
				links.join(inputEl.tagName === "TEXTAREA" ? "\n" : " "),
			);
		} catch (error) {
			log.logError(
				`Failed to insert pasted image link: ${error instanceof Error ? error.message : String(error)}`,
			);
			new Notice(
				"QuickAdd: saved the pasted image but could not insert its link.",
			);
		}
	}

	inputEl.addEventListener("paste", onPaste);
	inputEl.addEventListener("dragenter", onDragEnterOrOver);
	inputEl.addEventListener("dragover", onDragEnterOrOver);
	inputEl.addEventListener("dragleave", clearDropTarget);
	inputEl.addEventListener("drop", onDrop);
	inputEl.addEventListener("compositionstart", onCompositionStart);
	inputEl.addEventListener("compositionend", onCompositionEnd);

	return {
		isBusy: () => pendingSave !== null,
		whenIdle: () => pendingSave ?? Promise.resolve(),
		detach: () => {
			detached = true;
			clearDropTarget();
			inputEl.removeEventListener("paste", onPaste);
			inputEl.removeEventListener("dragenter", onDragEnterOrOver);
			inputEl.removeEventListener("dragover", onDragEnterOrOver);
			inputEl.removeEventListener("dragleave", clearDropTarget);
			inputEl.removeEventListener("drop", onDrop);
			inputEl.removeEventListener("compositionstart", onCompositionStart);
			inputEl.removeEventListener("compositionend", onCompositionEnd);
		},
	};
}

interface TransferredImageFile {
	file: File;
	mimeType: string;
}

export function decideTransfer(
	channel: ImageIntakeChannel,
	data: DataTransfer,
	app: App,
	now: Date,
): TransferDecision {
	switch (channel) {
		case "paste": {
			if (data.getData("text/plain").length > 0) {
				return { kind: "stand-down" };
			}
			const images = collectImageFiles(data).map<PromptImage>((image) => ({
				origin: "bytes",
				...image,
				naming: { kind: "clipboard-stamp" },
			}));
			return images.length > 0
				? { kind: "take", images }
				: { kind: "stand-down" };
		}
		case "drop": {
			const vaultImages = collectVaultImages(data, app);
			if (vaultImages.length > 0) {
				return { kind: "take", images: vaultImages };
			}
			const images = collectImageFiles(data).map<PromptImage>((image) => ({
				origin: "bytes",
				...image,
				naming: droppedImageNaming(image, now),
			}));
			return images.length > 0
				? { kind: "take", images }
				: { kind: "stand-down" };
		}
		default:
			return assertNever(channel);
	}
}

function collectVaultImages(data: DataTransfer, app: App): PromptImage[] {
	const images: PromptImage[] = [];
	for (const line of data.getData("text/plain").split(/\r?\n/u)) {
		const path = line.trim();
		if (
			path.length === 0 ||
			path.toLowerCase().startsWith("file://") ||
			escapesVaultBoundary(path)
		) {
			continue;
		}
		const file = app.vault.getAbstractFileByPath(path);
		if (isSupportedVaultImage(file)) {
			images.push({ origin: "vault", file });
		}
	}
	return images;
}

function isSupportedVaultImage(
	file: TAbstractFile | null,
): file is TFile {
	return (
		file !== null &&
		"extension" in file &&
		typeof file.extension === "string" &&
		isSupportedImageExtension(file.extension)
	);
}

function collectImageFiles(data: DataTransfer): TransferredImageFile[] {
	const images: TransferredImageFile[] = [];
	let hasFileItems = false;
	for (const item of Array.from(data.items ?? [])) {
		if (item.kind !== "file") continue;
		hasFileItems = true;
		if (!isSupportedImageMime(item.type)) continue;
		const file = item.getAsFile();
		if (file) images.push({ file, mimeType: item.type });
	}
	if (hasFileItems) return images;

	for (const file of Array.from(data.files ?? [])) {
		if (isSupportedImageMime(file.type)) {
			images.push({ file, mimeType: file.type });
		}
	}
	return images;
}

function droppedImageNaming(
	image: TransferredImageFile,
	now: Date,
): Extract<PromptImage, { origin: "bytes" }>["naming"] {
	const droppedFilename = droppedImageFilename(
		image.file.name,
		image.mimeType,
		now,
	);
	if (droppedFilename === clipboardImageFilename(image.mimeType, now)) {
		return { kind: "clipboard-stamp" };
	}

	const extension = IMAGE_CLIPBOARD_MIME_EXTENSIONS[image.mimeType];
	return {
		kind: "original-stem",
		stem: droppedFilename.slice(0, -(extension.length + 1)),
	};
}

function promptImageFilename(
	image: Extract<PromptImage, { origin: "bytes" }>,
	now: Date,
): string {
	switch (image.naming.kind) {
		case "clipboard-stamp":
			return clipboardImageFilename(image.mimeType, now);
		case "original-stem":
			return `${image.naming.stem}.${IMAGE_CLIPBOARD_MIME_EXTENSIONS[image.mimeType]}`;
		default:
			return assertNever(image.naming);
	}
}

function transferMayCarryFiles(data: DataTransfer): boolean {
	return Array.from(data.types ?? []).some(
		(type) => type === "Files" || isSupportedImageMime(type),
	);
}

function assertNever(value: never): never {
	throw new Error(`Unexpected image intake value: ${String(value)}`);
}

/**
 * Serializes all image vault writes in this window because attachment-path
 * deduplication only sees files after `createBinary` completes.
 */
let vaultSaveQueue: Promise<unknown> = Promise.resolve();
function enqueueVaultSave<T>(work: () => Promise<T>): Promise<T> {
	const result = vaultSaveQueue.then(work, work);
	vaultSaveQueue = result.catch(() => undefined);
	return result;
}

function insertAtSelection(
	inputEl: HTMLInputElement | HTMLTextAreaElement,
	text: string,
): void {
	inputEl.focus();
	// execCommand is undo-integrated and fires 'input' natively; ownerDocument
	// keeps it popout-window safe. Deprecated but the only undo-preserving
	// path for input/textarea; fall back to setRangeText when unavailable.
	let inserted = false;
	try {
		inserted = inputEl.ownerDocument.execCommand("insertText", false, text);
	} catch {
		inserted = false;
	}
	if (inserted) return;

	const start = inputEl.selectionStart ?? inputEl.value.length;
	const end = inputEl.selectionEnd ?? start;
	inputEl.setRangeText(text, start, end, "end");
	inputEl.dispatchEvent(new Event("input", { bubbles: true }));
}
