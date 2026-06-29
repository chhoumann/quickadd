import { describe, expect, it, vi } from "vitest";
import type { App } from "obsidian";
import { TFile, TFolder } from "obsidian";
import { openFile } from "./fileOpening";

type MockLeaf = {
	openFile: ReturnType<typeof vi.fn>;
	getViewState: () => { state: Record<string, unknown> };
	setViewState: ReturnType<typeof vi.fn>;
};

function makeApp(resolved: unknown): { app: App; leaf: MockLeaf } {
	const leaf: MockLeaf = {
		openFile: vi.fn(),
		getViewState: () => ({ state: {} }),
		setViewState: vi.fn(),
	};
	const app = {
		vault: { getAbstractFileByPath: () => resolved },
		workspace: {
			rootSplit: {},
			getMostRecentLeaf: () => null,
			getLeaf: () => leaf,
			setActiveLeaf: vi.fn(),
			iterateRootLeaves: () => {},
		},
	} as unknown as App;
	return { app, leaf };
}

describe("openFile folder guard", () => {
	it("throws 'File not found' for a folder path instead of opening the folder", async () => {
		// `getAbstractFileByPath` returns a TFolder for a folder path. A folder is
		// not openable as a file, so QuickAdd must surface its clean error rather
		// than handing the folder to `leaf.openFile`.
		const folder = new TFolder();
		folder.path = "People";
		const { app, leaf } = makeApp(folder);

		await expect(openFile(app, "People")).rejects.toThrow("File not found: People");
		expect(leaf.openFile).not.toHaveBeenCalled();
	});

	it("rejects a path-only object that has no string extension", async () => {
		// Asserts the guard's actual discriminator directly (rather than relying on
		// the stub TFolder happening to lack an `extension` field): a folder-shaped
		// value carries `path` but no `extension`, so it must not be opened.
		const { app, leaf } = makeApp({ path: "People" });

		await expect(openFile(app, "People")).rejects.toThrow("File not found: People");
		expect(leaf.openFile).not.toHaveBeenCalled();
	});

	it("opens a real TFile path", async () => {
		const file = new TFile();
		file.path = "People/Tom.md";
		file.extension = "md";
		const { app, leaf } = makeApp(file);

		await openFile(app, "People/Tom.md");
		expect(leaf.openFile).toHaveBeenCalledWith(file);
	});

	it("still accepts a cross-realm file-like object (path + extension, no instanceof)", async () => {
		// The duck-typing exists to tolerate TFile instances from another JS realm
		// where `instanceof TFile` fails. Tightening the guard must not break that.
		const fileLike = {
			path: "People/Tom.md",
			extension: "md",
			name: "Tom.md",
			basename: "Tom",
		};
		const { app, leaf } = makeApp(fileLike);

		await openFile(app, "People/Tom.md");
		expect(leaf.openFile).toHaveBeenCalledWith(fileLike);
	});
});
