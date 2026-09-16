import { vi } from "vitest";
import type { App, TFile } from "obsidian";

export function makeApp(vaultFiles: TFile[] = []) {
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

export function makeFile(name = "img.png", type = "image/png"): File {
	return new File([new Uint8Array([1, 2, 3])], name, { type });
}

export async function flushSaves(handle: { whenIdle(): Promise<void> }) {
	await handle.whenIdle();
	await new Promise((resolve) => setTimeout(resolve, 0));
}

export function makeInput(): HTMLInputElement {
	const input = document.createElement("input");
	document.body.appendChild(input);
	return input;
}

export function makeTextarea(): HTMLTextAreaElement {
	const textarea = document.createElement("textarea");
	document.body.appendChild(textarea);
	return textarea;
}

export function deferCreate(
	createBinary: ReturnType<typeof makeApp>["createBinary"],
): () => void {
	let finish: () => void = () => {};
	createBinary.mockImplementationOnce((path: string) =>
		new Promise<TFile>((resolve) => {
			finish = () => resolve({ path } as TFile);
		}),
	);
	return () => finish();
}
