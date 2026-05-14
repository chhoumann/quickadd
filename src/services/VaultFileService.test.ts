import { beforeEach, describe, expect, it, vi } from "vitest";
import type { App } from "obsidian";
import { TFile, TFolder } from "obsidian";
import { VaultFileService } from "./VaultFileService";
import { withTemplaterFileCreationSuppressed } from "../utilityObsidian";
import type * as UtilityObsidian from "../utilityObsidian";

vi.mock("../utilityObsidian", async (importOriginal) => {
	const actual = await importOriginal<typeof UtilityObsidian>();
	return {
		...actual,
		withTemplaterFileCreationSuppressed: vi.fn(
			async (_app, _path, createFile: () => Promise<TFile>) => createFile(),
		),
	};
});

function file(path: string, extension = "md"): TFile {
	const result = new TFile();
	result.path = path;
	result.extension = extension;
	return result;
}

function folder(path: string): TFolder {
	const result = new TFolder();
	result.path = path;
	return result;
}

describe("VaultFileService", () => {
	let app: App;
	let service: VaultFileService;
	let abstractFiles: Map<string, TFile | TFolder>;

	beforeEach(() => {
		abstractFiles = new Map();
		app = {
			vault: {
				adapter: { exists: vi.fn() },
				getAbstractFileByPath: vi.fn((path: string) => abstractFiles.get(path)),
				createFolder: vi.fn(),
				create: vi.fn(async (path: string) => file(path)),
			},
		} as unknown as App;
		service = new VaultFileService(app);
		vi.mocked(withTemplaterFileCreationSuppressed).mockClear();
	});

	it("returns files by path and rejects missing paths and folders", () => {
		const note = file("notes/a.md");
		abstractFiles.set("notes/a.md", note);
		abstractFiles.set("notes", folder("notes"));

		expect(service.getFileByPath("notes/a.md")).toBe(note);
		expect(() => service.getFileByPath("missing.md")).toThrow(
			"missing.md not found",
		);
		expect(() => service.getFileByPath("notes")).toThrow(
			"notes found but it's a folder",
		);
	});

	it("delegates file existence to the adapter", async () => {
		vi.mocked(app.vault.adapter.exists).mockResolvedValueOnce(true);
		await expect(service.fileExists("a.md")).resolves.toBe(true);
		expect(app.vault.adapter.exists).toHaveBeenCalledWith("a.md");

		vi.mocked(app.vault.adapter.exists).mockResolvedValueOnce(false);
		await expect(service.fileExists("b.md")).resolves.toBe(false);
		expect(app.vault.adapter.exists).toHaveBeenCalledWith("b.md");
	});

	it("creates folders idempotently", async () => {
		vi.mocked(app.vault.adapter.exists).mockResolvedValueOnce(false);
		await service.createFolder("notes");
		expect(app.vault.createFolder).toHaveBeenCalledWith("notes");

		vi.mocked(app.vault.createFolder).mockClear();
		vi.mocked(app.vault.adapter.exists).mockResolvedValueOnce(true);
		await service.createFolder("notes");
		expect(app.vault.createFolder).not.toHaveBeenCalled();
	});

	it("creates missing parent folders before files and skips root parents", async () => {
		vi.mocked(app.vault.adapter.exists).mockResolvedValue(false);

		await service.createFileWithInput("notes/new.md", "body");
		expect(app.vault.createFolder).toHaveBeenCalledWith("notes");
		expect(app.vault.create).toHaveBeenCalledWith("notes/new.md", "body");
		expect(
			vi.mocked(app.vault.createFolder).mock.invocationCallOrder[0],
		).toBeLessThan(vi.mocked(app.vault.create).mock.invocationCallOrder[0]);

		vi.mocked(app.vault.createFolder).mockClear();
		vi.mocked(app.vault.create).mockClear();
		await service.createFileWithInput("root.md", "body");
		expect(app.vault.createFolder).not.toHaveBeenCalled();
		expect(app.vault.create).toHaveBeenCalledWith("root.md", "body");
	});

	it("suppresses templater on-create only for markdown files when requested", async () => {
		await service.createFileWithInput("note.md", "body", {
			suppressTemplaterOnCreate: true,
		});
		expect(withTemplaterFileCreationSuppressed).toHaveBeenCalledTimes(1);
		expect(withTemplaterFileCreationSuppressed).toHaveBeenCalledWith(
			app,
			"note.md",
			expect.any(Function),
		);

		vi.mocked(withTemplaterFileCreationSuppressed).mockClear();
		await service.createFileWithInput("board.canvas", "{}", {
			suppressTemplaterOnCreate: true,
		});
		await service.createFileWithInput("plain.md", "body");
		expect(withTemplaterFileCreationSuppressed).not.toHaveBeenCalled();
	});
});
