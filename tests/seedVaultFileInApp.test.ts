import { describe, expect, it, vi } from "vitest";
import {
	seedVaultFileInApp,
	type SeedVaultApp,
	type SeedVaultFile,
} from "./e2e/seedVaultFileInApp";

interface MockVaultState {
	files: Map<string, SeedVaultFile>;
	disk: Set<string>;
}

function createMockApp(state: MockVaultState, options?: {
	createFolderError?: Error;
	reconcile?: "folder" | "file" | "none";
}): SeedVaultApp {
	const createFolder = vi.fn(async (folder: string) => {
		if (options?.createFolderError) throw options.createFolderError;
		state.files.set(folder, { path: folder });
		state.disk.add(folder);
	});
	const create = vi.fn(async (path: string, _content: string) => {
		const file = { path };
		state.files.set(path, file);
		state.disk.add(path);
		return file;
	});
	const modify = vi.fn(async (_file: SeedVaultFile, _content: string) => undefined);
	const exists = vi.fn(async (path: string) => state.disk.has(path));
	const reconcileFolderCreation = vi.fn(async (folder: string) => {
		state.files.set(folder, { path: folder });
	});
	const reconcileFile = vi.fn(async (folder: string) => {
		state.files.set(folder, { path: folder });
	});

	const adapter: SeedVaultApp["vault"]["adapter"] = { exists };
	if (options?.reconcile === "folder" || options?.reconcile === undefined) {
		adapter.reconcileFolderCreation = reconcileFolderCreation;
	}
	if (options?.reconcile === "file") {
		adapter.reconcileFile = reconcileFile;
	}

	return {
		vault: {
			getAbstractFileByPath: (path: string) => state.files.get(path) ?? null,
			createFolder,
			create,
			modify,
			adapter,
		},
	};
}

describe("seedVaultFileInApp", () => {
	it("creates missing parent folders, then creates the file", async () => {
		const state: MockVaultState = { files: new Map(), disk: new Set() };
		const app = createMockApp(state);

		await expect(
			seedVaultFileInApp(app, "sandbox/note.md", "hello"),
		).resolves.toBe("sandbox/note.md");

		expect(app.vault.createFolder).toHaveBeenCalledWith("sandbox");
		expect(app.vault.create).toHaveBeenCalledWith("sandbox/note.md", "hello");
		expect(app.vault.modify).not.toHaveBeenCalled();
		expect(app.vault.adapter.reconcileFolderCreation).not.toHaveBeenCalled();
	});

	it("skips createFolder when the parent is already indexed", async () => {
		const state: MockVaultState = {
			files: new Map([["sandbox", { path: "sandbox" }]]),
			disk: new Set(["sandbox"]),
		};
		const app = createMockApp(state);

		await seedVaultFileInApp(app, "sandbox/note.md", "hello");

		expect(app.vault.createFolder).not.toHaveBeenCalled();
		expect(app.vault.adapter.reconcileFolderCreation).not.toHaveBeenCalled();
	});

	it("registers an on-disk unindexed parent without calling createFolder", async () => {
		const state: MockVaultState = {
			files: new Map(),
			disk: new Set(["sandbox"]),
		};
		const alreadyExists = new Error("Folder already exists.");
		const app = createMockApp(state, { createFolderError: alreadyExists });

		await expect(
			seedVaultFileInApp(app, "sandbox/note.md", "hello"),
		).resolves.toBe("sandbox/note.md");

		expect(app.vault.adapter.reconcileFolderCreation).toHaveBeenCalledWith(
			"sandbox",
			"sandbox",
		);
		expect(app.vault.createFolder).not.toHaveBeenCalled();
		expect(app.vault.create).toHaveBeenCalledWith("sandbox/note.md", "hello");
	});

	it("falls back to reconcileFile when reconcileFolderCreation is missing", async () => {
		const state: MockVaultState = {
			files: new Map(),
			disk: new Set(["sandbox"]),
		};
		const app = createMockApp(state, { reconcile: "file" });

		await expect(
			seedVaultFileInApp(app, "sandbox/note.md", "hello"),
		).resolves.toBe("sandbox/note.md");

		expect(app.vault.adapter.reconcileFile).toHaveBeenCalledWith("sandbox");
		expect(app.vault.createFolder).not.toHaveBeenCalled();
	});

	it("reconciles after createFolder throws if the parent is on disk", async () => {
		const state: MockVaultState = { files: new Map(), disk: new Set() };
		const alreadyExists = new Error("Folder already exists.");
		const app = createMockApp(state, { createFolderError: alreadyExists });
		// Folder appears on disk between the exists() probe and createFolder.
		vi.mocked(app.vault.adapter.exists).mockResolvedValueOnce(false);
		vi.mocked(app.vault.adapter.exists).mockImplementation(async (path) => {
			state.disk.add(path);
			return true;
		});

		await expect(
			seedVaultFileInApp(app, "sandbox/note.md", "hello"),
		).resolves.toBe("sandbox/note.md");

		expect(app.vault.createFolder).toHaveBeenCalledWith("sandbox");
		expect(app.vault.adapter.reconcileFolderCreation).toHaveBeenCalledWith(
			"sandbox",
			"sandbox",
		);
	});

	it("rethrows createFolder errors when the parent is neither indexed nor on disk", async () => {
		const state: MockVaultState = { files: new Map(), disk: new Set() };
		const failure = new Error("permission denied");
		const app = createMockApp(state, { createFolderError: failure });

		await expect(
			seedVaultFileInApp(app, "sandbox/note.md", "hello"),
		).rejects.toThrow("permission denied");
		expect(app.vault.create).not.toHaveBeenCalled();
	});

	it("modifies an already-indexed file", async () => {
		const existing = { path: "sandbox/note.md" };
		const state: MockVaultState = {
			files: new Map([
				["sandbox", { path: "sandbox" }],
				["sandbox/note.md", existing],
			]),
			disk: new Set(["sandbox", "sandbox/note.md"]),
		};
		const app = createMockApp(state);

		await expect(
			seedVaultFileInApp(app, "sandbox/note.md", "updated"),
		).resolves.toBe("sandbox/note.md");

		expect(app.vault.modify).toHaveBeenCalledWith(existing, "updated");
		expect(app.vault.create).not.toHaveBeenCalled();
	});
});
