import { TFolder, type App } from "obsidian";
import { describe, expect, it, vi } from "vitest";
import { getAllFolderPathsInVault } from "./vaultQueries";

function createFolder(path: string): TFolder {
	const folder = new TFolder();
	folder.path = path;
	folder.name = path.split("/").pop() ?? path;
	return folder;
}

describe("getAllFolderPathsInVault", () => {
	it("filters to folders and maps paths without sorting", () => {
		const app = {
			vault: {
				getAllLoadedFiles: vi.fn(() => [
					createFolder("B"),
					{ path: "A/file.md" },
					createFolder("A"),
					createFolder("A/C"),
				]),
			},
		} as unknown as App;

		expect(getAllFolderPathsInVault(app)).toEqual(["B", "A", "A/C"]);
	});
});
