import type { App } from "obsidian";
import { Notice } from "obsidian";
import { log } from "../logger/logManager";
import {
	buildImageEmbedLink,
	IMAGE_CLIPBOARD_MIME_EXTENSIONS,
	saveClipboardImageToVault,
} from "../utils/clipboardImageAttachments";

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
 * Lets an input/textarea accept clipboard IMAGE paste: the image is saved as a
 * vault attachment (via Obsidian's attachment-folder logic) and an embed link
 * is inserted at the caret. Clipboard TEXT always wins - when text/plain is
 * non-empty the event is left to the default paste, byte-parity with the
 * shipped `{{CLIPBOARD}}` image fallback's precedence.
 *
 * Attach only to inputs whose value flows into note content as free text;
 * a pasted embed link in a file-name or path prompt would corrupt the path.
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

	const onPaste = (event: ClipboardEvent) => {
		const data = event.clipboardData;
		if (!data) return;
		// Mid-IME-composition value mutation desyncs the composition buffer.
		if (composing) return;
		// Text wins: leave the event to the default paste. Untrimmed check, so
		// whitespace-only text still wins (parity with the capture fallback).
		if (data.getData("text/plain").length > 0) return;

		// Extract the Files SYNCHRONOUSLY: Chromium neuters the DataTransfer
		// once this handler yields (items empty, getAsFile() null after await).
		const images = collectImageFiles(data);
		if (images.length === 0) return;

		event.preventDefault();
		if (pendingSave) {
			new Notice(
				"QuickAdd: an image is still being saved — paste again in a moment.",
			);
			return;
		}
		pendingSave = saveAndInsert(images).finally(() => {
			pendingSave = null;
		});
	};

	async function saveAndInsert(images: File[]): Promise<void> {
		// Freeze the input during the save so the caret cannot go stale from
		// typing; the embed is inserted at the LIVE selection afterwards.
		const wasReadOnly = inputEl.readOnly;
		inputEl.readOnly = true;
		inputEl.setAttribute("aria-busy", "true");
		inputEl.classList.add("qa-image-paste-busy");

		const links: string[] = [];
		try {
			// Strictly sequential: the attachment-path dedupe only sees files
			// whose createBinary landed, so parallel same-second saves collide.
			for (const image of images) {
				const file = await saveClipboardImageToVault(
					app,
					await image.arrayBuffer(),
					image.type,
					sourcePath,
				);
				links.push(buildImageEmbedLink(app, file, sourcePath));
			}
		} catch (error) {
			// Images saved before the failure keep their links (they are real
			// vault files by now); only the failing one is reported.
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
		insertAtSelection(
			inputEl,
			links.join(inputEl.tagName === "TEXTAREA" ? "\n" : " "),
		);
	}

	inputEl.addEventListener("paste", onPaste);
	inputEl.addEventListener("compositionstart", onCompositionStart);
	inputEl.addEventListener("compositionend", onCompositionEnd);

	return {
		isBusy: () => pendingSave !== null,
		whenIdle: () => pendingSave ?? Promise.resolve(),
		detach: () => {
			detached = true;
			inputEl.removeEventListener("paste", onPaste);
			inputEl.removeEventListener("compositionstart", onCompositionStart);
			inputEl.removeEventListener("compositionend", onCompositionEnd);
		},
	};
}

function collectImageFiles(data: DataTransfer): File[] {
	const images: File[] = [];
	for (const item of Array.from(data.items ?? [])) {
		if (item.kind !== "file") continue;
		if (IMAGE_CLIPBOARD_MIME_EXTENSIONS[item.type] === undefined) continue;
		const file = item.getAsFile();
		if (file) images.push(file);
	}
	if (images.length > 0) return images;

	// Some webviews only populate .files.
	for (const file of Array.from(data.files ?? [])) {
		if (IMAGE_CLIPBOARD_MIME_EXTENSIONS[file.type] !== undefined) {
			images.push(file);
		}
	}
	return images;
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
