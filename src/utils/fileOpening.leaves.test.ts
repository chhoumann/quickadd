import {
	type App,
	TFile,
	type WorkspaceContainer,
	type WorkspaceLeaf,
} from "obsidian";
import { describe, expect, it, vi } from "vitest";
import { areSameVaultFilePath, getOpenFileOriginLeaf, openFile } from "./fileOpening";

type FakeLeaf = WorkspaceLeaf & {
	id: string;
	pinned?: boolean;
	openFile: ReturnType<typeof vi.fn>;
	getViewState: ReturnType<typeof vi.fn>;
	setViewState: ReturnType<typeof vi.fn>;
};

// A leaf's window is its container; a main-area leaf's root is not a sidebar.
const mainWindow = { id: "main-window" } as unknown as WorkspaceContainer;
const popoutWindow = { id: "popout-window" } as unknown as WorkspaceContainer;

function createLeaf(id: string, pinned = false, window = mainWindow): FakeLeaf {
	const leaf = { id, pinned } as FakeLeaf;
	Object.assign(leaf, { getContainer: () => window, getRoot: () => window });

	leaf.openFile = vi.fn(async () => undefined);
	leaf.getViewState = vi.fn(() => ({
		type: "markdown",
		state: { file: `${id}.md` },
		...(leaf.pinned ? { pinned: true } : {}),
	}));
	leaf.setViewState = vi.fn(async () => undefined);

	return leaf;
}

function createFile(path = "target.md"): TFile {
	const file = new TFile();
	file.path = path;
	file.name = path.split("/").pop() ?? path;
	file.extension = path.split(".").pop() ?? "";
	file.basename = file.name.replace(/\.[^.]+$/, "");
	return file;
}

function setParent(leaf: FakeLeaf, parent: { id: string }): FakeLeaf {
	(leaf as unknown as { parent: { id: string } }).parent = parent;
	return leaf;
}

function createApp({
	rootLeaves,
	originLeaf,
	activeLeaf = originLeaf,
	mostRecentLeaf = originLeaf,
	tabLeaf = createLeaf("tab"),
	reuseLeaf = activeLeaf ?? tabLeaf,
	splitLeaf = createLeaf("split"),
	windowLeaf = createLeaf("window"),
	leftSidebarLeaf = createLeaf("left-sidebar"),
	rightSidebarLeaf = createLeaf("right-sidebar"),
}: {
	rootLeaves: FakeLeaf[];
	originLeaf: FakeLeaf | null;
	activeLeaf?: FakeLeaf | null;
	mostRecentLeaf?: FakeLeaf | null;
	tabLeaf?: FakeLeaf;
	reuseLeaf?: FakeLeaf;
	splitLeaf?: FakeLeaf;
	windowLeaf?: FakeLeaf;
	leftSidebarLeaf?: FakeLeaf;
	rightSidebarLeaf?: FakeLeaf;
}) {
	const getLeaf = vi.fn((location?: unknown) => {
		if (location === "tab") return tabLeaf;
		if (location === false) return reuseLeaf;
		if (location === "split") return splitLeaf;
		if (location === "window") return windowLeaf;
		return reuseLeaf;
	});
	const setActiveLeaf = vi.fn();
	// Like Obsidian: with a root it searches that root only, and the main
	// window's root split holds no pop-out leaf.
	const getMostRecentLeaf = vi.fn((root?: unknown) =>
		root && mostRecentLeaf?.getContainer() !== mainWindow
			? (rootLeaves.find((leaf) => leaf.getContainer() === mainWindow) ?? null)
			: mostRecentLeaf,
	);
	const iterateAllLeaves = vi.fn((callback: (leaf: WorkspaceLeaf) => void) => {
		rootLeaves.forEach(callback);
	});

	const app = {
		workspace: {
			activeLeaf,
			rootSplit: mainWindow,
			leftSplit: { id: "left-split" },
			rightSplit: { id: "right-split" },
			getMostRecentLeaf,
			getLeaf,
			getLeftLeaf: vi.fn(() => leftSidebarLeaf),
			getRightLeaf: vi.fn(() => rightSidebarLeaf),
			iterateAllLeaves,
			setActiveLeaf,
			// Obsidian's own getActiveViewOfType reads `activeLeaf`.
			getActiveViewOfType(this: { activeLeaf?: WorkspaceLeaf | null }) {
				return this.activeLeaf ? { leaf: this.activeLeaf } : null;
			},
		},
		vault: {
			getAbstractFileByPath: vi.fn(),
		},
	} as unknown as App;

	return {
		app,
		getLeaf,
		iterateAllLeaves,
		setActiveLeaf,
	};
}

describe("getOpenFileOriginLeaf", () => {
	it("captures the leaf last used in a pop-out window", () => {
		const mainLeaf = createLeaf("main");
		const popoutLeaf = createLeaf("popout", false, popoutWindow);
		const { app } = createApp({
			rootLeaves: [mainLeaf, popoutLeaf],
			originLeaf: popoutLeaf,
		});

		expect(getOpenFileOriginLeaf(app)).toBe(popoutLeaf);
	});
});

describe("openFile", () => {
	it("routes tab opens from a pinned origin into an unpinned sibling", async () => {
		const pinnedOriginLeaf = createLeaf("pinned-origin", true);
		const unpinnedSiblingLeaf = createLeaf("unpinned-sibling");
		const tabLeaf = createLeaf("tab");
		const file = createFile();
		const { app, getLeaf, setActiveLeaf } = createApp({
			rootLeaves: [pinnedOriginLeaf, unpinnedSiblingLeaf],
			originLeaf: pinnedOriginLeaf,
			tabLeaf,
		});

		const leaf = await openFile(app, file, {
			location: "tab",
			originLeaf: pinnedOriginLeaf,
		});

		expect(leaf).toBe(unpinnedSiblingLeaf);
		expect(unpinnedSiblingLeaf.openFile).toHaveBeenCalledWith(file);
		expect(tabLeaf.openFile).not.toHaveBeenCalled();
		expect(getLeaf).not.toHaveBeenCalledWith("tab");
		expect(setActiveLeaf).toHaveBeenCalledWith(unpinnedSiblingLeaf, {
			focus: true,
		});
	});

	it("routes away from a transient leaf in the pinned origin's tab group", async () => {
		const lockedGroup = { id: "locked-group" };
		const rightGroup = { id: "right-group" };
		const pinnedOriginLeaf = setParent(
			createLeaf("pinned-origin", true),
			lockedGroup,
		);
		const transientLeaf = setParent(createLeaf("transient"), lockedGroup);
		const unpinnedSiblingLeaf = setParent(
			createLeaf("unpinned-sibling"),
			rightGroup,
		);
		const tabLeaf = createLeaf("tab");
		const file = createFile();
		const { app, getLeaf } = createApp({
			rootLeaves: [transientLeaf, unpinnedSiblingLeaf],
			originLeaf: pinnedOriginLeaf,
			activeLeaf: transientLeaf,
			mostRecentLeaf: transientLeaf,
			tabLeaf,
		});

		const leaf = await openFile(app, file, {
			location: "tab",
			originLeaf: pinnedOriginLeaf,
		});

		expect(leaf).toBe(unpinnedSiblingLeaf);
		expect(transientLeaf.openFile).not.toHaveBeenCalled();
		expect(unpinnedSiblingLeaf.openFile).toHaveBeenCalledWith(file);
		expect(getLeaf).not.toHaveBeenCalledWith("tab");
	});

	it("routes reuse opens from a pinned origin into an unpinned sibling", async () => {
		const pinnedOriginLeaf = createLeaf("pinned-origin", true);
		const unpinnedSiblingLeaf = createLeaf("unpinned-sibling");
		const reuseLeaf = createLeaf("reuse");
		const file = createFile();
		const { app, getLeaf } = createApp({
			rootLeaves: [pinnedOriginLeaf, unpinnedSiblingLeaf],
			originLeaf: pinnedOriginLeaf,
			reuseLeaf,
		});

		const leaf = await openFile(app, file, {
			location: "reuse",
			originLeaf: pinnedOriginLeaf,
		});

		expect(leaf).toBe(unpinnedSiblingLeaf);
		expect(unpinnedSiblingLeaf.openFile).toHaveBeenCalledWith(file);
		expect(reuseLeaf.openFile).not.toHaveBeenCalled();
		expect(getLeaf).not.toHaveBeenCalledWith(false);
	});

	it("treats nested view-state pinning as pinned navigation state", async () => {
		const pinnedOriginLeaf = createLeaf("pinned-origin");
		pinnedOriginLeaf.getViewState.mockReturnValue({
			type: "markdown",
			state: { file: "pinned-origin.md", pinned: true },
		});
		const unpinnedSiblingLeaf = createLeaf("unpinned-sibling");
		const tabLeaf = createLeaf("tab");
		const file = createFile();
		const { app, getLeaf } = createApp({
			rootLeaves: [pinnedOriginLeaf, unpinnedSiblingLeaf],
			originLeaf: pinnedOriginLeaf,
			tabLeaf,
		});

		const leaf = await openFile(app, file, {
			location: "tab",
			originLeaf: pinnedOriginLeaf,
		});

		expect(leaf).toBe(unpinnedSiblingLeaf);
		expect(unpinnedSiblingLeaf.openFile).toHaveBeenCalledWith(file);
		expect(tabLeaf.openFile).not.toHaveBeenCalled();
		expect(getLeaf).not.toHaveBeenCalledWith("tab");
	});

	it("preserves normal tab behavior when the origin is not pinned", async () => {
		const unpinnedOriginLeaf = createLeaf("origin");
		const tabLeaf = createLeaf("tab");
		const file = createFile();
		const { app, getLeaf } = createApp({
			rootLeaves: [unpinnedOriginLeaf],
			originLeaf: unpinnedOriginLeaf,
			tabLeaf,
		});

		const leaf = await openFile(app, file, {
			location: "tab",
			originLeaf: unpinnedOriginLeaf,
		});

		expect(leaf).toBe(tabLeaf);
		expect(getLeaf).toHaveBeenCalledWith("tab");
		expect(tabLeaf.openFile).toHaveBeenCalledWith(file);
		expect(unpinnedOriginLeaf.openFile).not.toHaveBeenCalled();
	});

	it("falls back to normal tab creation when no unpinned sibling exists", async () => {
		const pinnedOriginLeaf = createLeaf("pinned-origin", true);
		const pinnedSiblingLeaf = createLeaf("pinned-sibling", true);
		const tabLeaf = createLeaf("tab");
		const file = createFile();
		const { app, getLeaf } = createApp({
			rootLeaves: [pinnedOriginLeaf, pinnedSiblingLeaf],
			originLeaf: pinnedOriginLeaf,
			tabLeaf,
		});

		const leaf = await openFile(app, file, {
			location: "tab",
			originLeaf: pinnedOriginLeaf,
		});

		expect(leaf).toBe(tabLeaf);
		expect(getLeaf).toHaveBeenCalledWith("tab");
		expect(tabLeaf.openFile).toHaveBeenCalledWith(file);
	});

	it("falls back to a new tab for reuse when no unpinned sibling exists", async () => {
		const pinnedOriginLeaf = createLeaf("pinned-origin", true);
		const pinnedSiblingLeaf = createLeaf("pinned-sibling", true);
		const reuseLeaf = createLeaf("reuse");
		const tabLeaf = createLeaf("tab");
		const file = createFile();
		const { app, getLeaf } = createApp({
			rootLeaves: [pinnedOriginLeaf, pinnedSiblingLeaf],
			originLeaf: pinnedOriginLeaf,
			reuseLeaf,
			tabLeaf,
		});

		const leaf = await openFile(app, file, {
			location: "reuse",
			originLeaf: pinnedOriginLeaf,
		});

		expect(leaf).toBe(tabLeaf);
		expect(getLeaf).toHaveBeenCalledWith("tab");
		expect(getLeaf).not.toHaveBeenCalledWith(false);
		expect(tabLeaf.openFile).toHaveBeenCalledWith(file);
		expect(reuseLeaf.openFile).not.toHaveBeenCalled();
	});

	it("opens a new tab for a pop-out run while the main window's last tab is pinned", async () => {
		const pinnedMainLeaf = setParent(createLeaf("pinned-main", true), {
			id: "left-group",
		});
		const unpinnedMainLeaf = setParent(createLeaf("unpinned-main"), {
			id: "right-group",
		});
		const popoutLeaf = setParent(createLeaf("popout", false, popoutWindow), {
			id: "popout-group",
		});
		const tabLeaf = createLeaf("tab", false, popoutWindow);
		const file = createFile();
		const { app } = createApp({
			rootLeaves: [pinnedMainLeaf, unpinnedMainLeaf, popoutLeaf],
			originLeaf: popoutLeaf,
			tabLeaf,
		});

		const leaf = await openFile(app, file, { location: "tab" });

		expect(leaf).toBe(tabLeaf);
		expect(unpinnedMainLeaf.openFile).not.toHaveBeenCalled();
	});

	it("keeps a pinned pop-out origin from taking over a main-window tab", async () => {
		const unpinnedMainLeaf = setParent(createLeaf("unpinned-main"), {
			id: "main-group",
		});
		const pinnedPopoutLeaf = setParent(
			createLeaf("pinned-popout", true, popoutWindow),
			{ id: "popout-group" },
		);
		const tabLeaf = createLeaf("tab", false, popoutWindow);
		const file = createFile();
		const { app } = createApp({
			rootLeaves: [unpinnedMainLeaf, pinnedPopoutLeaf],
			originLeaf: pinnedPopoutLeaf,
			tabLeaf,
		});

		const leaf = await openFile(app, file, { location: "tab" });

		expect(leaf).toBe(tabLeaf);
		expect(unpinnedMainLeaf.openFile).not.toHaveBeenCalled();
	});

	it("leaves explicit split behavior unchanged for pinned origins", async () => {
		const pinnedOriginLeaf = createLeaf("pinned-origin", true);
		const unpinnedSiblingLeaf = createLeaf("unpinned-sibling");
		const splitLeaf = createLeaf("split");
		const file = createFile();
		const { app, getLeaf, iterateAllLeaves } = createApp({
			rootLeaves: [pinnedOriginLeaf, unpinnedSiblingLeaf],
			originLeaf: pinnedOriginLeaf,
			splitLeaf,
		});

		const leaf = await openFile(app, file, {
			location: "split",
			direction: "horizontal",
			originLeaf: pinnedOriginLeaf,
		});

		expect(leaf).toBe(splitLeaf);
		expect(getLeaf).toHaveBeenCalledWith("split", "horizontal");
		expect(iterateAllLeaves).not.toHaveBeenCalled();
		expect(unpinnedSiblingLeaf.openFile).not.toHaveBeenCalled();
		expect(splitLeaf.openFile).toHaveBeenCalledWith(file);
	});
});

describe("areSameVaultFilePath", () => {
	it("matches logically equivalent vault paths", () => {
		expect(areSameVaultFilePath("notes//capture.md", "notes/capture.md")).toBe(
			true,
		);
		expect(areSameVaultFilePath("/notes/capture.md", "notes/capture.md")).toBe(
			true,
		);
		expect(areSameVaultFilePath("notes\\capture.md", "notes/capture.md")).toBe(
			true,
		);
	});

	it("keeps case-sensitive mismatches distinct", () => {
		expect(areSameVaultFilePath("notes/Foo.md", "notes/foo.md")).toBe(false);
	});
});
