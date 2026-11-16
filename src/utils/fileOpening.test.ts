import { describe, expect, it, vi } from "vitest";
import type { App, WorkspaceLeaf } from "obsidian";
import { FileView, TFile, TFolder } from "obsidian";
import { openExistingFileTab, openFile } from "./fileOpening";

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
			getMostRecentLeaf: () => null,
			getLeaf: () => leaf,
			setActiveLeaf: vi.fn(),
			iterateAllLeaves: () => {},
			// Obsidian's own getActiveViewOfType reads `activeLeaf`.
			getActiveViewOfType(this: { activeLeaf?: WorkspaceLeaf | null }) {
				return this.activeLeaf ? { leaf: this.activeLeaf } : null;
			},
		},
	} as unknown as App;
	return { app, leaf };
}

describe("openExistingFileTab", () => {
	const mainWindow = {};
	const popoutWindow = {};
	const sidebar = {};

	function target(): TFile {
		const file = new TFile();
		file.path = "Target.md";
		return file;
	}

	// A leaf's window is its container; a sidebar leaf's root is its sidebar.
	function fileLeaf(file: TFile | null, window: object, root = window): WorkspaceLeaf {
		return {
			view: Object.assign(Object.create(FileView.prototype), { file }),
			getContainer: () => window,
			getRoot: () => root,
		} as unknown as WorkspaceLeaf;
	}

	function appWithLeaves(file: TFile, leaves: WorkspaceLeaf[], focused?: WorkspaceLeaf): App {
		const { app } = makeApp(file);
		Object.assign(app.workspace, {
			activeLeaf: focused ?? null,
			rightSplit: sidebar,
			iterateAllLeaves: (callback: (leaf: WorkspaceLeaf) => void) => {
				leaves.forEach(callback);
			},
		});
		return app;
	}

	it.each([0, 1, -1])("preserves the active matching tab at index %s", activeIndex => {
		const file = target();
		const leaves = [fileLeaf(file, mainWindow), fileLeaf(file, mainWindow)];
		const app = appWithLeaves(file, leaves, leaves[activeIndex]);
		const expected = leaves[activeIndex] ?? leaves[1];
		expect(openExistingFileTab(app, file)).toBe(expected);
		expect(app.workspace.setActiveLeaf).toHaveBeenCalledExactlyOnceWith(expected, { focus: true });
	});

	it("focuses a tab showing the file in a pop-out window", () => {
		const file = target();
		const popoutLeaf = fileLeaf(file, popoutWindow);
		const app = appWithLeaves(file, [fileLeaf(null, mainWindow), popoutLeaf]);

		expect(openExistingFileTab(app, file)).toBe(popoutLeaf);
		expect(app.workspace.setActiveLeaf).toHaveBeenCalledExactlyOnceWith(popoutLeaf, { focus: true });
	});

	it("prefers a matching tab in the focused window over another window's", () => {
		const file = target();
		const focused = fileLeaf(null, mainWindow);
		const mainLeaf = fileLeaf(file, mainWindow);
		const app = appWithLeaves(
			file,
			[focused, mainLeaf, fileLeaf(file, popoutWindow)],
			focused,
		);

		expect(openExistingFileTab(app, file)).toBe(mainLeaf);
	});

	it("does not treat a sidebar leaf showing the file as an open tab", () => {
		const file = target();
		const app = appWithLeaves(file, [fileLeaf(file, mainWindow, sidebar)]);

		expect(openExistingFileTab(app, file)).toBeNull();
	});
});

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

describe("openFile focus", () => {
	it("restores the active leaf synchronously when creating a background tab activates it", async () => {
		const file = new TFile();
		const { app, leaf } = makeApp(file);
		const previousLeaf = {} as WorkspaceLeaf;
		app.workspace.activeLeaf = previousLeaf;
		app.workspace.getLeaf = vi.fn(() => {
			app.workspace.activeLeaf = leaf as unknown as WorkspaceLeaf;
			return app.workspace.activeLeaf;
		});
		vi.mocked(app.workspace.setActiveLeaf).mockImplementation((active) => {
			app.workspace.activeLeaf = active;
		});
		leaf.openFile.mockImplementation(() => {
			expect(app.workspace.activeLeaf).toBe(previousLeaf);
		});

		await openFile(app, file, { focus: false, mode: "source" });

		expect(app.workspace.setActiveLeaf).toHaveBeenCalledExactlyOnceWith(
			previousLeaf,
			{ focus: false },
		);
	});

	it.each([undefined, "source", "preview"] as const)(
		"opens in the background with mode %s without activating either operation",
		async (mode) => {
			const file = new TFile();
			file.path = "Background.md";
			const { app, leaf } = makeApp(file);

			await openFile(app, file, { focus: false, mode });

			expect(leaf.openFile).toHaveBeenCalledWith(file, { active: false });
			if (mode) {
				expect(leaf.setViewState).toHaveBeenCalledWith(
					expect.objectContaining({ active: false }),
				);
			} else {
				expect(leaf.setViewState).not.toHaveBeenCalled();
			}
			expect(app.workspace.setActiveLeaf).not.toHaveBeenCalled();
		},
	);

	it("focuses the opened leaf by default", async () => {
		const file = new TFile();
		const { app, leaf } = makeApp(file);

		await openFile(app, file, { mode: "source" });

		expect(leaf.openFile).toHaveBeenCalledWith(file);
		expect(app.workspace.setActiveLeaf).toHaveBeenCalledWith(leaf, { focus: true });
	});
});
