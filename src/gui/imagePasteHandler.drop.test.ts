import type { App, TFile } from "obsidian";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
	attachImagePasteHandler,
	ingestImagesIntoActivePrompt,
} from "./imagePasteHandler";

vi.mock("obsidian", () => ({
	Notice: vi.fn(),
}));

vi.mock("../logger/logManager", () => ({
	log: { logError: vi.fn(), logWarning: vi.fn(), logMessage: vi.fn() },
}));

import { log } from "../logger/logManager";
import { Notice } from "obsidian";
import { settingsStore } from "../settingsStore";

function makeApp(vaultFiles: TFile[] = []) {
	const created: string[] = [];
	const createBinary = vi.fn(async (path: string, _data: ArrayBuffer) => {
		created.push(path);
		return { path } as TFile;
	});
	const getAvailablePathForAttachment = vi.fn(
		async (filename: string, _sourcePath?: string) => {
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
	const filesByPath = new Map(vaultFiles.map((file) => [file.path, file]));
	const getAbstractFileByPath = vi.fn(
		(path: string) => filesByPath.get(path) ?? null,
	);
	const app = {
		vault: { createBinary, getAbstractFileByPath },
		fileManager: { getAvailablePathForAttachment, generateMarkdownLink },
	} as unknown as App;

	return {
		app,
		createBinary,
		created,
		getAbstractFileByPath,
		getAvailablePathForAttachment,
	};
}

function makeFile(name: string, type: string): File {
	return new File([new Uint8Array([1, 2, 3])], name, { type });
}

function makeDropData(
	files: File[],
	text = "",
	types: string[] = files.length > 0 ? ["Files"] : [],
): DataTransfer {
	return {
		getData: (format: string) => (format === "text/plain" ? text : ""),
		items: files.map((file) => ({
			kind: "file",
			type: file.type,
			getAsFile: () => file,
		})),
		files,
		types,
	} as unknown as DataTransfer;
}

function dispatchDrag(
	el: HTMLElement,
	type: "dragenter" | "dragover" | "dragleave" | "drop",
	data: DataTransfer,
): DragEvent {
	const event = new Event(type, { bubbles: true, cancelable: true });
	Object.defineProperty(event, "dataTransfer", { value: data });
	el.dispatchEvent(event);
	return event as DragEvent;
}

async function flushSaves(handle: { whenIdle(): Promise<void> }) {
	await handle.whenIdle();
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
	vi.mocked(log.logMessage).mockClear();
});

describe("attachImagePasteHandler image drop", () => {
	it("saves a dropped PNG under its original filename and inserts an embed", async () => {
		const { app, createBinary, getAvailablePathForAttachment } = makeApp();
		const input = makeInput();
		const handle = attachImagePasteHandler(app, input, {});

		const event = dispatchDrag(
			input,
			"drop",
			makeDropData([makeFile("sunset.png", "image/png")]),
		);
		expect(event.defaultPrevented).toBe(true);
		await flushSaves(handle);

		expect(getAvailablePathForAttachment).toHaveBeenCalledWith(
			"sunset.png",
			undefined,
		);
		expect(createBinary).toHaveBeenCalledTimes(1);
		expect(input.value).toBe("![[attachments/sunset.png]]");
		expect(input.value).not.toContain("Clipboard image");
	});

	it("keeps the dropped filename when destination-title naming is on", async () => {
		settingsStore.setState({ namePastedImagesAfterNoteTitle: true });
		try {
			const { app, getAvailablePathForAttachment } = makeApp();
			const input = makeInput();
			const handle = attachImagePasteHandler(app, input, {
				sourcePath: "Meetings/Meeting notes.md",
			});

			dispatchDrag(
				input,
				"drop",
				makeDropData([makeFile("sunset.png", "image/png")]),
			);
			await flushSaves(handle);

			expect(getAvailablePathForAttachment).toHaveBeenCalledWith(
				"sunset.png",
				"Meetings/Meeting notes.md",
			);
			expect(input.value).toBe("![[attachments/sunset.png]]");
			handle.detach();
		} finally {
			settingsStore.setState({ namePastedImagesAfterNoteTitle: false });
		}
	});

	it("saves a file-manager image when text/plain contains its filesystem path", async () => {
		const { app, createBinary } = makeApp();
		const input = makeInput();
		const handle = attachImagePasteHandler(app, input, {});

		dispatchDrag(
			input,
			"drop",
			makeDropData(
				[makeFile("sunset.png", "image/png")],
				"/home/me/Pictures/sunset.png",
			),
		);
		await flushSaves(handle);

		expect(createBinary).toHaveBeenCalledTimes(1);
		expect(input.value).toBe("![[attachments/sunset.png]]");
		expect(input.value).not.toContain("/home/me/Pictures");
	});

	it("stands down for a PDF-only drop", async () => {
		const { app, createBinary } = makeApp();
		const input = makeInput();
		const handle = attachImagePasteHandler(app, input, {});

		const event = dispatchDrag(
			input,
			"drop",
			makeDropData([makeFile("guide.pdf", "application/pdf")]),
		);
		await flushSaves(handle);

		expect(event.defaultPrevented).toBe(false);
		expect(createBinary).not.toHaveBeenCalled();
		expect(input.value).toBe("");
	});

	it("saves only supported images from a mixed drop", async () => {
		const { app, createBinary } = makeApp();
		const input = makeInput();
		const handle = attachImagePasteHandler(app, input, {});

		dispatchDrag(
			input,
			"drop",
			makeDropData([
				makeFile("photo.png", "image/png"),
				makeFile("guide.pdf", "application/pdf"),
			]),
		);
		await flushSaves(handle);

		expect(createBinary).toHaveBeenCalledTimes(1);
		expect(input.value).toBe("![[attachments/photo.png]]");
	});

	it("saves multiple drops sequentially and joins links for each field type", async () => {
		const { app, created } = makeApp();
		let inFlight = 0;
		let maxInFlight = 0;
		const createBinary = app.vault.createBinary as ReturnType<typeof vi.fn>;
		createBinary.mockImplementation(async (path: string) => {
			inFlight++;
			maxInFlight = Math.max(maxInFlight, inFlight);
			await new Promise((resolve) => setTimeout(resolve, 5));
			inFlight--;
			created.push(path);
			return { path } as TFile;
		});
		const input = makeInput();
		const textarea = makeTextarea();
		const inputHandle = attachImagePasteHandler(app, input, {});
		const textareaHandle = attachImagePasteHandler(app, textarea, {});

		dispatchDrag(
			input,
			"drop",
			makeDropData([
				makeFile("a.png", "image/png"),
				makeFile("b.png", "image/png"),
			]),
		);
		await flushSaves(inputHandle);
		dispatchDrag(
			textarea,
			"drop",
			makeDropData([
				makeFile("c.png", "image/png"),
				makeFile("d.png", "image/png"),
			]),
		);
		await flushSaves(textareaHandle);

		expect(maxInFlight).toBe(1);
		expect(input.value).toBe(
			"![[attachments/a.png]] ![[attachments/b.png]]",
		);
		expect(textarea.value).toBe(
			"![[attachments/c.png]]\n![[attachments/d.png]]",
		);
	});

	it("notices instead of interleaving a second drop during a save", async () => {
		const { app, createBinary } = makeApp();
		let resolveCreate: () => void = () => {};
		createBinary.mockImplementationOnce(
			(path: string) =>
				new Promise<TFile>((resolve) => {
					resolveCreate = () => resolve({ path } as TFile);
				}),
		);
		const input = makeInput();
		const handle = attachImagePasteHandler(app, input, {});

		dispatchDrag(
			input,
			"drop",
			makeDropData([makeFile("first.png", "image/png")]),
		);
		await vi.waitFor(() => expect(createBinary).toHaveBeenCalled());
		const second = dispatchDrag(
			input,
			"drop",
			makeDropData([makeFile("second.png", "image/png")]),
		);

		expect(second.defaultPrevented).toBe(true);
		expect(Notice).toHaveBeenCalledWith(
			"QuickAdd: an image is still being saved — drop again in a moment.",
		);
		resolveCreate();
		await flushSaves(handle);

		expect(createBinary).toHaveBeenCalledTimes(1);
		expect(input.value).toBe("![[attachments/first.png]]");
	});

	it("skips insertion when detached during a dropped-image save", async () => {
		const { app, createBinary } = makeApp();
		let resolveCreate: () => void = () => {};
		createBinary.mockImplementationOnce(
			(path: string) =>
				new Promise<TFile>((resolve) => {
					resolveCreate = () => resolve({ path } as TFile);
				}),
		);
		const input = makeInput();
		const handle = attachImagePasteHandler(app, input, {});

		dispatchDrag(
			input,
			"drop",
			makeDropData([makeFile("photo.png", "image/png")]),
		);
		await vi.waitFor(() => expect(createBinary).toHaveBeenCalled());
		handle.detach();
		resolveCreate();
		await flushSaves(handle);

		expect(input.value).toBe("");
	});

	it("ignores drops during IME composition", async () => {
		const { app, createBinary } = makeApp();
		const input = makeInput();
		const handle = attachImagePasteHandler(app, input, {});
		const data = makeDropData([makeFile("photo.png", "image/png")]);

		input.dispatchEvent(new Event("compositionstart"));
		const during = dispatchDrag(input, "drop", data);
		expect(during.defaultPrevented).toBe(false);

		input.dispatchEvent(new Event("compositionend"));
		dispatchDrag(input, "drop", data);
		await flushSaves(handle);

		expect(createBinary).toHaveBeenCalledTimes(1);
	});

	it("accepts file drags during dragover and clears the target class", () => {
		const { app } = makeApp();
		const input = makeInput();
		const handle = attachImagePasteHandler(app, input, {});
		const data = makeDropData([makeFile("photo.png", "image/png")]);

		const dragover = dispatchDrag(input, "dragover", data);
		expect(dragover.defaultPrevented).toBe(true);
		expect(input.classList.contains("qa-image-drop-target")).toBe(true);

		dispatchDrag(input, "dragleave", data);
		expect(input.classList.contains("qa-image-drop-target")).toBe(false);
		handle.detach();
	});

	it("embeds a vault-relative image without creating another file", async () => {
		const vaultImage = {
			path: "Assets/photo.jpeg",
			extension: "jpeg",
			basename: "photo",
		} as TFile;
		const { app, createBinary, getAbstractFileByPath } = makeApp([vaultImage]);
		const input = makeInput();
		const handle = attachImagePasteHandler(app, input, {});

		dispatchDrag(
			input,
			"drop",
			makeDropData(
				[makeFile("photo.jpeg", "image/jpeg")],
				"Assets/photo.jpeg",
			),
		);
		await flushSaves(handle);

		expect(getAbstractFileByPath).toHaveBeenCalledWith("Assets/photo.jpeg");
		expect(createBinary).not.toHaveBeenCalled();
		expect(input.value).toBe("![[Assets/photo.jpeg]]");
	});

	it("treats an absolute text path as external and saves the dropped file", async () => {
		const { app, createBinary, getAbstractFileByPath } = makeApp();
		const input = makeInput();
		const handle = attachImagePasteHandler(app, input, {});

		dispatchDrag(
			input,
			"drop",
			makeDropData(
				[makeFile("photo.png", "image/png")],
				"C:\\Users\\me\\photo.png",
			),
		);
		await flushSaves(handle);

		expect(getAbstractFileByPath).not.toHaveBeenCalled();
		expect(createBinary).toHaveBeenCalledTimes(1);
		expect(input.value).toBe("![[attachments/photo.png]]");
	});

	it("does not embed a text-only drop of a vault-relative image path", async () => {
		const vaultImage = {
			path: "Assets/photo.jpeg",
			extension: "jpeg",
			basename: "photo",
		} as TFile;
		const { app, createBinary } = makeApp([vaultImage]);
		const input = makeInput();
		const handle = attachImagePasteHandler(app, input, {});

		const event = dispatchDrag(input, "drop", {
			getData: (format: string) =>
				format === "text/plain" ? "Assets/photo.jpeg" : "",
			items: [],
			files: [],
			types: ["text/plain"],
		} as unknown as DataTransfer);
		await flushSaves(handle);

		expect(event.defaultPrevented).toBe(false);
		expect(createBinary).not.toHaveBeenCalled();
		expect(input.value).toBe("");
		handle.detach();
	});

	it("saves an image whose item MIME is empty when File.type is supported", async () => {
		const { app, createBinary } = makeApp();
		const input = makeInput();
		const handle = attachImagePasteHandler(app, input, {});
		const file = makeFile("sunset.png", "image/png");

		dispatchDrag(input, "drop", {
			getData: () => "",
			items: [{ kind: "file", type: "", getAsFile: () => file }],
			files: [file],
			types: ["Files"],
		} as unknown as DataTransfer);
		await flushSaves(handle);

		expect(createBinary).toHaveBeenCalledTimes(1);
		expect(input.value).toBe("![[attachments/sunset.png]]");
		handle.detach();
	});
});

describe("ingestImagesIntoActivePrompt", () => {
	it("saves via ingestFiles and inserts an embed without a DragEvent", async () => {
		const { app, createBinary } = makeApp();
		const input = makeInput();
		input.focus();
		const handle = attachImagePasteHandler(app, input, {});

		const inserted = await handle.ingestFiles([
			makeFile("sunset.png", "image/png"),
		]);

		expect(inserted).toBe("![[attachments/sunset.png]]");
		expect(createBinary).toHaveBeenCalledTimes(1);
		expect(input.value).toBe("![[attachments/sunset.png]]");
		expect(log.logMessage).toHaveBeenCalledWith(
			"QuickAdd: ingested 1 image(s) into the active prompt.",
		);
		handle.detach();
	});

	it("returns no-active-prompt when nothing is attached", async () => {
		const result = await ingestImagesIntoActivePrompt([
			makeFile("sunset.png", "image/png"),
		]);

		expect(result).toEqual({ ok: false, reason: "no-active-prompt" });
		expect(log.logMessage).toHaveBeenCalledWith(
			"QuickAdd: image ingest skipped (no-active-prompt).",
		);
	});

	it("ingests into the focused attached prompt", async () => {
		const { app } = makeApp();
		const first = makeInput();
		const second = makeInput();
		const firstHandle = attachImagePasteHandler(app, first, {});
		const secondHandle = attachImagePasteHandler(app, second, {});
		first.focus();

		const result = await ingestImagesIntoActivePrompt([
			makeFile("sunset.png", "image/png"),
		]);

		expect(result).toEqual({
			ok: true,
			inserted: "![[attachments/sunset.png]]",
		});
		expect(first.value).toBe("![[attachments/sunset.png]]");
		expect(second.value).toBe("");
		firstHandle.detach();
		secondHandle.detach();
	});

	it("returns no-images for an unsupported file", async () => {
		const { app, createBinary } = makeApp();
		const input = makeInput();
		const handle = attachImagePasteHandler(app, input, {});

		const result = await ingestImagesIntoActivePrompt([
			makeFile("guide.pdf", "application/pdf"),
		]);

		expect(result).toEqual({ ok: false, reason: "no-images" });
		expect(createBinary).not.toHaveBeenCalled();
		expect(log.logMessage).toHaveBeenCalledWith(
			"QuickAdd: image ingest skipped (no-images).",
		);
		handle.detach();
	});
});
