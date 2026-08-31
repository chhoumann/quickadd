import type { App, TAbstractFile, TFile } from "obsidian";
import { Notice } from "obsidian";
import { log } from "../logger/logManager";
import {
	IMAGE_CLIPBOARD_MIME_EXTENSIONS,
	buildImageEmbedLink,
	clipboardImageFilename,
	droppedImageStem,
	isSupportedImageExtension,
	isSupportedImageMime,
	saveImageBytesToVault,
} from "../utils/clipboardImageAttachments";
import { escapesVaultBoundary } from "../utils/vaultPathBoundary";

type PromptImage =
	| {
			origin: "bytes";
			file: File;
			mimeType: string;
			naming:
				| { kind: "clipboard-stamp" }
				| { kind: "original-stem"; stem: string };
	  }
	| { origin: "vault"; file: TFile };

type TransferDecision =
	| { kind: "stand-down" }
	| { kind: "take"; images: PromptImage[] };

type ImageIntakeChannel = "paste" | "drop";

export interface ImagePasteOptions {
	/**
	 * Note path the inserted link will live in when known (capture
	 * destination). "" (default) resolves attachment placement against the
	 * vault root and makes the link a vault-root path that resolves from any
	 * note.
	 */
	sourcePath?: string;
}

export interface ImagePasteHandle {
	/** True while an image save is in flight. */
	isBusy(): boolean;
	/** Resolves once no image save is in flight (immediately when idle). */
	whenIdle(): Promise<void>;
	/** Saves files as dropped images and inserts embed links; returns the inserted text. */
	ingestFiles(files: File[]): Promise<string>;
	/** Removes all listeners; a still-running save keeps its file but skips the text insertion. */
	detach(): void;
}

export type ImageIngestResult =
	| { ok: true; inserted: string }
	| { ok: false; reason: "no-active-prompt" | "no-images" | "busy" };

type AttachedPrompt = {
	handle: ImagePasteHandle;
	inputEl: HTMLInputElement | HTMLTextAreaElement;
};

const attachedPrompts: AttachedPrompt[] = [];

function pickAttachedPrompt(): AttachedPrompt | null {
	const live = attachedPrompts.filter((entry) => entry.inputEl.isConnected);
	const focused = live.find(
		(entry) =>
			document.activeElement !== null &&
			entry.inputEl.contains(document.activeElement),
	);
	return focused ?? live.at(-1) ?? null;
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
				pendingSave = beginIntake(decision.images, now)
					.then(() => undefined)
					.finally(() => {
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
		acceptDecision("paste", event, decideTransfer("paste", data, app), now);
	};

	const onDragEnterOrOver = (event: DragEvent) => {
		if (composing) return;
		const data = event.dataTransfer;
		if (!data || !transferMayCarryFiles(data)) return;
		event.preventDefault();
		data.dropEffect = "copy";
		inputEl.classList.add("qa-image-drop-target");
	};

	const clearDropTarget = () => {
		inputEl.classList.remove("qa-image-drop-target");
	};

	const onDrop = (event: DragEvent) => {
		clearDropTarget();
		if (composing) return;
		const data = event.dataTransfer;
		if (!data || !transferMayCarryFiles(data)) return;
		const now = new Date();
		acceptDecision("drop", event, decideTransfer("drop", data, app), now);
	};

	async function beginIntake(
		images: PromptImage[],
		now: Date,
	): Promise<string> {
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
				`Failed to save image: ${error instanceof Error ? error.message : String(error)}`,
			);
			new Notice("QuickAdd: failed to save image.");
		} finally {
			inputEl.readOnly = wasReadOnly;
			inputEl.removeAttribute("aria-busy");
			inputEl.classList.remove("qa-image-paste-busy");
		}

		if (links.length === 0 || detached) return "";
		const inserted =
			links.join(inputEl.tagName === "TEXTAREA" ? "\n" : " ");
		try {
			insertAtSelection(inputEl, inserted);
			return inserted;
		} catch (error) {
			log.logError(
				`Failed to insert image link: ${error instanceof Error ? error.message : String(error)}`,
			);
			new Notice(
				"QuickAdd: saved the image but could not insert its link.",
			);
			return "";
		}
	}

	async function ingestFiles(files: File[]): Promise<string> {
		const now = new Date();
		const images = promptImagesFromFiles(files);
		if (images.length === 0) {
			log.logMessage("QuickAdd: image ingest skipped (no-images).");
			return "";
		}
		if (pendingSave) {
			new Notice(
				"QuickAdd: an image is still being saved — drop again in a moment.",
			);
			log.logMessage("QuickAdd: image ingest skipped (busy).");
			return "";
		}
		let inserted = "";
		pendingSave = (async () => {
			inserted = await beginIntake(images, now);
		})().finally(() => {
			pendingSave = null;
		});
		await pendingSave;
		if (inserted.length > 0) {
			log.logMessage(
				`QuickAdd: ingested ${images.length} image(s) into the active prompt.`,
			);
		}
		return inserted;
	}

	inputEl.addEventListener("paste", onPaste);
	inputEl.addEventListener("dragenter", onDragEnterOrOver);
	inputEl.addEventListener("dragover", onDragEnterOrOver);
	inputEl.addEventListener("dragleave", clearDropTarget);
	inputEl.addEventListener("drop", onDrop);
	inputEl.addEventListener("compositionstart", onCompositionStart);
	inputEl.addEventListener("compositionend", onCompositionEnd);

	const handle: ImagePasteHandle = {
		isBusy: () => pendingSave !== null,
		whenIdle: () => pendingSave ?? Promise.resolve(),
		ingestFiles,
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
			const index = attachedPrompts.findIndex(
				(entry) => entry.handle === handle,
			);
			if (index >= 0) attachedPrompts.splice(index, 1);
		},
	};
	attachedPrompts.push({ handle, inputEl });
	return handle;
}

export async function ingestImagesIntoActivePrompt(
	files: File[],
): Promise<ImageIngestResult> {
	const attached = pickAttachedPrompt();
	if (!attached) {
		log.logMessage("QuickAdd: image ingest skipped (no-active-prompt).");
		return { ok: false, reason: "no-active-prompt" };
	}
	if (attached.handle.isBusy()) {
		log.logMessage("QuickAdd: image ingest skipped (busy).");
		return { ok: false, reason: "busy" };
	}
	const inserted = await attached.handle.ingestFiles(files);
	if (inserted.length === 0) {
		return { ok: false, reason: "no-images" };
	}
	return { ok: true, inserted };
}

interface TransferredImageFile {
	file: File;
	mimeType: string;
}

function decideTransfer(
	channel: ImageIntakeChannel,
	data: DataTransfer,
	app: App,
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
				naming: droppedImageNaming(image),
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
	const seen = new Set<string>();

	const push = (file: File, mimeType: string) => {
		const key = `${file.name}\0${file.size}\0${file.type}`;
		if (seen.has(key)) return;
		seen.add(key);
		images.push({ file, mimeType });
	};

	for (const item of Array.from(data.items ?? [])) {
		if (item.kind !== "file") continue;
		if (!isSupportedImageMime(item.type)) continue;
		const file = item.getAsFile();
		if (file) push(file, item.type);
	}

	for (const file of Array.from(data.files ?? [])) {
		if (isSupportedImageMime(file.type)) {
			push(file, file.type);
		}
	}
	return images;
}

function promptImagesFromFiles(files: File[]): PromptImage[] {
	return files.flatMap((file) => {
		if (!isSupportedImageMime(file.type)) return [];
		const image: TransferredImageFile = { file, mimeType: file.type };
		return [
			{
				origin: "bytes" as const,
				...image,
				naming: droppedImageNaming(image),
			},
		];
	});
}

function droppedImageNaming(
	image: TransferredImageFile,
): Extract<PromptImage, { origin: "bytes" }>["naming"] {
	const stem = droppedImageStem(image.file.name);
	if (stem === null) return { kind: "clipboard-stamp" };
	return { kind: "original-stem", stem };
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
