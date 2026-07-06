import { beforeEach, describe, expect, it, vi } from "vitest";
import type { App, TFile } from "obsidian";
import { attachImagePasteHandler } from "./imagePasteHandler";

vi.mock("obsidian", () => ({
	Notice: vi.fn(),
}));

vi.mock("../logger/logManager", () => ({
	log: { logError: vi.fn(), logWarning: vi.fn(), logMessage: vi.fn() },
}));

import { Notice } from "obsidian";

function makeApp() {
	const created: string[] = [];
	const createBinary = vi.fn(async (path: string, _data: ArrayBuffer) => {
		created.push(path);
		return { path } as TFile;
	});
	const getAvailablePathForAttachment = vi.fn(
		async (filename: string, _sourcePath?: string) => {
			// Mimic Obsidian's dedupe against files that already exist.
			let candidate = `attachments/${filename}`;
			let counter = 1;
			while (created.includes(candidate)) {
				candidate = `attachments/${filename.replace(/(\.\w+)$/, ` ${counter}$1`)}`;
				counter++;
			}
			return candidate;
		},
	);
	const generateMarkdownLink = vi.fn(
		(file: TFile, _sourcePath: string) => `![[${file.path}]]`,
	);
	const app = {
		vault: { createBinary },
		fileManager: { getAvailablePathForAttachment, generateMarkdownLink },
	} as unknown as App;
	return { app, createBinary, getAvailablePathForAttachment, created };
}

function makeImageFile(name = "img.png", type = "image/png"): File {
	return new File([new Uint8Array([1, 2, 3])], name, { type });
}

/**
 * jsdom has no DataTransfer constructor; the handler only touches
 * getData/items/files, so a structural fake dispatched via a plain Event with
 * a defined clipboardData property exercises the same code path.
 */
function makeClipboardData(images: File[], text = ""): DataTransfer {
	return {
		getData: (format: string) => (format === "text/plain" ? text : ""),
		items: images.map((file) => ({
			kind: "file",
			type: file.type,
			getAsFile: () => file,
		})),
		files: images,
	} as unknown as DataTransfer;
}

function dispatchPaste(
	el: HTMLElement,
	data: DataTransfer,
): ClipboardEvent {
	const event = new Event("paste", { bubbles: true, cancelable: true });
	Object.defineProperty(event, "clipboardData", { value: data });
	el.dispatchEvent(event);
	return event as ClipboardEvent;
}

async function flushSaves(handle: { whenIdle(): Promise<void> }) {
	await handle.whenIdle();
	// whenIdle resolves via .finally; give the insertion microtask a beat.
	await new Promise((resolve) => setTimeout(resolve, 0));
}

function makeInput(): HTMLInputElement {
	const input = document.createElement("input");
	document.body.appendChild(input);
	return input;
}

function makeTextarea(): HTMLTextAreaElement {
	const textarea = document.createElement("textarea");
	document.body.appendChild(textarea);
	return textarea;
}

beforeEach(() => {
	document.body.innerHTML = "";
	vi.mocked(Notice).mockClear();
});

describe("attachImagePasteHandler", () => {
	it("saves a pasted image and inserts an embed link at the caret", async () => {
		const { app, createBinary } = makeApp();
		const input = makeInput();
		input.value = "before after";
		input.setSelectionRange(7, 7);
		const handle = attachImagePasteHandler(app, input, {});

		const event = dispatchPaste(input, makeClipboardData([makeImageFile()]));
		expect(event.defaultPrevented).toBe(true);
		await flushSaves(handle);

		expect(createBinary).toHaveBeenCalledTimes(1);
		expect(input.value).toMatch(
			/^before !\[\[attachments\/Clipboard image .*\.png\]\]after$/,
		);
	});

	it("fires an input event so component onChange observers update", async () => {
		const { app } = makeApp();
		const input = makeInput();
		const onInput = vi.fn();
		input.addEventListener("input", onInput);
		const handle = attachImagePasteHandler(app, input, {});

		dispatchPaste(input, makeClipboardData([makeImageFile()]));
		await flushSaves(handle);

		expect(onInput).toHaveBeenCalled();
	});

	it("lets text win: no save, no preventDefault when text/plain is non-empty", async () => {
		const { app, createBinary } = makeApp();
		const input = makeInput();
		const handle = attachImagePasteHandler(app, input, {});

		const event = dispatchPaste(
			input,
			makeClipboardData([makeImageFile()], "clipboard text"),
		);
		await flushSaves(handle);

		expect(event.defaultPrevented).toBe(false);
		expect(createBinary).not.toHaveBeenCalled();
	});

	it("whitespace-only text still wins (parity with the capture fallback)", async () => {
		const { app, createBinary } = makeApp();
		const input = makeInput();
		const handle = attachImagePasteHandler(app, input, {});

		const event = dispatchPaste(input, makeClipboardData([makeImageFile()], "  "));
		await flushSaves(handle);

		expect(event.defaultPrevented).toBe(false);
		expect(createBinary).not.toHaveBeenCalled();
	});

	it("ignores pastes without image data", async () => {
		const { app, createBinary } = makeApp();
		const input = makeInput();
		const handle = attachImagePasteHandler(app, input, {});

		const event = dispatchPaste(input, makeClipboardData([]));
		await flushSaves(handle);

		expect(event.defaultPrevented).toBe(false);
		expect(createBinary).not.toHaveBeenCalled();
	});

	it("ignores non-image files", async () => {
		const { app, createBinary } = makeApp();
		const input = makeInput();
		const handle = attachImagePasteHandler(app, input, {});

		const event = dispatchPaste(
			input,
			makeClipboardData([makeImageFile("doc.pdf", "application/pdf")]),
		);
		await flushSaves(handle);

		expect(event.defaultPrevented).toBe(false);
		expect(createBinary).not.toHaveBeenCalled();
	});

	it("saves multiple images sequentially with distinct paths, space-joined in inputs", async () => {
		const { app, created } = makeApp();
		const input = makeInput();
		const handle = attachImagePasteHandler(app, input, {});

		dispatchPaste(
			input,
			makeClipboardData([makeImageFile("a.png"), makeImageFile("b.png")]),
		);
		await flushSaves(handle);

		expect(created).toHaveLength(2);
		expect(new Set(created).size).toBe(2);
		expect(input.value).toMatch(/^!\[\[.*\]\] !\[\[.*\]\]$/);
	});

	it("joins multiple images with newlines in textareas", async () => {
		const { app } = makeApp();
		const textarea = makeTextarea();
		const handle = attachImagePasteHandler(app, textarea, {});

		dispatchPaste(
			textarea,
			makeClipboardData([makeImageFile("a.png"), makeImageFile("b.png")]),
		);
		await flushSaves(handle);

		expect(textarea.value).toMatch(/^!\[\[.*\]\]\n!\[\[.*\]\]$/);
	});

	it("freezes the input during the save and unfreezes afterwards", async () => {
		const { app } = makeApp();
		let resolveCreate: () => void = () => {};
		const createBinary = app.vault.createBinary as ReturnType<typeof vi.fn>;
		createBinary.mockImplementationOnce(
			(path: string) =>
				new Promise<TFile>((resolve) => {
					resolveCreate = () => resolve({ path } as TFile);
				}),
		);
		const input = makeInput();
		const handle = attachImagePasteHandler(app, input, {});

		dispatchPaste(input, makeClipboardData([makeImageFile()]));
		await vi.waitFor(() => expect(createBinary).toHaveBeenCalled());
		expect(input.readOnly).toBe(true);
		expect(handle.isBusy()).toBe(true);

		resolveCreate();
		await flushSaves(handle);
		expect(input.readOnly).toBe(false);
		expect(handle.isBusy()).toBe(false);
	});

	it("notices instead of interleaving when a second paste arrives mid-save", async () => {
		const { app } = makeApp();
		let resolveCreate: () => void = () => {};
		const createBinary = app.vault.createBinary as ReturnType<typeof vi.fn>;
		createBinary.mockImplementationOnce(
			(path: string) =>
				new Promise<TFile>((resolve) => {
					resolveCreate = () => resolve({ path } as TFile);
				}),
		);
		const input = makeInput();
		const handle = attachImagePasteHandler(app, input, {});

		dispatchPaste(input, makeClipboardData([makeImageFile()]));
		await vi.waitFor(() => expect(createBinary).toHaveBeenCalled());
		const second = dispatchPaste(input, makeClipboardData([makeImageFile()]));

		expect(second.defaultPrevented).toBe(true);
		expect(Notice).toHaveBeenCalledWith(
			expect.stringContaining("still being saved"),
		);

		resolveCreate();
		await flushSaves(handle);
		// Only the first paste's image landed.
		expect(input.value.match(/!\[\[/g)).toHaveLength(1);
	});

	it("keeps successfully saved images when a later one fails, and notices", async () => {
		const { app } = makeApp();
		const input = makeInput();
		(app.vault.createBinary as ReturnType<typeof vi.fn>)
			.mockImplementationOnce(async (path: string) => ({ path }) as TFile)
			.mockImplementationOnce(async () => {
				throw new Error("disk full");
			});
		const handle = attachImagePasteHandler(app, input, {});

		dispatchPaste(
			input,
			makeClipboardData([makeImageFile("a.png"), makeImageFile("b.png")]),
		);
		await flushSaves(handle);

		expect(input.value.match(/!\[\[/g)).toHaveLength(1);
		expect(Notice).toHaveBeenCalledWith(
			expect.stringContaining("failed to save pasted image"),
		);
		expect(input.readOnly).toBe(false);
	});

	it("does nothing after detach", async () => {
		const { app, createBinary } = makeApp();
		const input = makeInput();
		const handle = attachImagePasteHandler(app, input, {});
		handle.detach();

		const event = dispatchPaste(input, makeClipboardData([makeImageFile()]));
		await flushSaves(handle);

		expect(event.defaultPrevented).toBe(false);
		expect(createBinary).not.toHaveBeenCalled();
	});

	it("skips the text insertion when detached mid-save (modal closed)", async () => {
		const { app } = makeApp();
		let resolveCreate: () => void = () => {};
		const createBinary = app.vault.createBinary as ReturnType<typeof vi.fn>;
		createBinary.mockImplementationOnce(
			(path: string) =>
				new Promise<TFile>((resolve) => {
					resolveCreate = () => resolve({ path } as TFile);
				}),
		);
		const input = makeInput();
		const handle = attachImagePasteHandler(app, input, {});

		dispatchPaste(input, makeClipboardData([makeImageFile()]));
		await vi.waitFor(() => expect(createBinary).toHaveBeenCalled());
		handle.detach();
		resolveCreate();
		await flushSaves(handle);

		expect(input.value).toBe("");
	});

	it("ignores paste during IME composition", async () => {
		const { app, createBinary } = makeApp();
		const input = makeInput();
		const handle = attachImagePasteHandler(app, input, {});

		input.dispatchEvent(new Event("compositionstart"));
		const during = dispatchPaste(input, makeClipboardData([makeImageFile()]));
		expect(during.defaultPrevented).toBe(false);

		input.dispatchEvent(new Event("compositionend"));
		dispatchPaste(input, makeClipboardData([makeImageFile()]));
		await flushSaves(handle);

		expect(createBinary).toHaveBeenCalledTimes(1);
	});

	it("passes the sourcePath through to placement and link generation", async () => {
		const { app, getAvailablePathForAttachment } = makeApp();
		const input = makeInput();
		const handle = attachImagePasteHandler(app, input, {
			sourcePath: "Journal/today.md",
		});

		dispatchPaste(input, makeClipboardData([makeImageFile()]));
		await flushSaves(handle);

		expect(getAvailablePathForAttachment).toHaveBeenCalledWith(
			expect.any(String),
			"Journal/today.md",
		);
		expect(
			(app.fileManager.generateMarkdownLink as ReturnType<typeof vi.fn>).mock
				.calls[0][1],
		).toBe("Journal/today.md");
	});
});

describe("attachImagePasteHandler - review hardening (issue #1484)", () => {
	it("uses the DataTransferItem MIME when the File reports an empty type", async () => {
		const { app, getAvailablePathForAttachment } = makeApp();
		const input = makeInput();
		const handle = attachImagePasteHandler(app, input, {});

		// getAsFile() can return a File whose .type is empty; the item's
		// declared MIME must drive the extension.
		const bare = new File([new Uint8Array([1])], "img", { type: "" });
		const data = {
			getData: () => "",
			items: [{ kind: "file", type: "image/png", getAsFile: () => bare }],
			files: [],
		} as unknown as DataTransfer;
		dispatchPaste(input, data);
		await flushSaves(handle);

		expect(getAvailablePathForAttachment).toHaveBeenCalledWith(
			expect.stringMatching(/\.png$/),
			undefined,
		);
		expect(input.value).toMatch(/!\[\[.*\.png\]\]/);
	});

	it("ignores Object.prototype member names masquerading as MIME types", async () => {
		const { app, createBinary } = makeApp();
		const input = makeInput();
		const handle = attachImagePasteHandler(app, input, {});

		const event = dispatchPaste(
			input,
			makeClipboardData([makeImageFile("evil", "constructor")]),
		);
		await flushSaves(handle);

		expect(event.defaultPrevented).toBe(false);
		expect(createBinary).not.toHaveBeenCalled();
	});

	it("keeps whenIdle resolved (never rejected) when link insertion fails", async () => {
		const { app } = makeApp();
		const input = makeInput();
		const setRangeText = input.setRangeText.bind(input);
		input.setRangeText = () => {
			throw new Error("insertion blew up");
		};
		const handle = attachImagePasteHandler(app, input, {});

		dispatchPaste(input, makeClipboardData([makeImageFile()]));
		await expect(handle.whenIdle()).resolves.toBeUndefined();
		await flushSaves(handle);

		expect(Notice).toHaveBeenCalledWith(
			expect.stringContaining("could not insert its link"),
		);
		expect(handle.isBusy()).toBe(false);
		input.setRangeText = setRangeText;
	});

	it("serializes saves across two handlers (one-page cross-field pastes)", async () => {
		const { app, created } = makeApp();
		let inFlight = 0;
		let maxInFlight = 0;
		const realCreate = app.vault.createBinary as ReturnType<typeof vi.fn>;
		realCreate.mockImplementation(async (path: string) => {
			inFlight++;
			maxInFlight = Math.max(maxInFlight, inFlight);
			await new Promise((resolve) => setTimeout(resolve, 10));
			inFlight--;
			created.push(path);
			return { path } as TFile;
		});
		const inputA = makeInput();
		const inputB = makeInput();
		const handleA = attachImagePasteHandler(app, inputA, {});
		const handleB = attachImagePasteHandler(app, inputB, {});

		dispatchPaste(inputA, makeClipboardData([makeImageFile("a.png")]));
		dispatchPaste(inputB, makeClipboardData([makeImageFile("b.png")]));
		await flushSaves(handleA);
		await flushSaves(handleB);
		await new Promise((resolve) => setTimeout(resolve, 50));

		expect(created).toHaveLength(2);
		expect(new Set(created).size).toBe(2);
		expect(maxInFlight).toBe(1);
	});
});
