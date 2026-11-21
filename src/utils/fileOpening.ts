import type { App, TFile, WorkspaceLeaf } from "obsidian";
import { FileView, View } from "obsidian";
import type { OpenFileOptions, OpenLocation } from "../types/fileOpening";
import { normalizeVaultPathSeparators } from "./pathUtils";
import { DEFAULT_FILE_OPENING } from "./fileOpeningDefaults";
import { isTFileLike } from "./isTFileLike";

export type OpenFileRuntimeOptions = OpenFileOptions & {
	/**
	 * Transient origin leaf captured before Obsidian creates a new tab.
	 * This is intentionally not persisted in choice settings.
	 */
	originLeaf?: WorkspaceLeaf | null;
};

type PinnedLeafViewState = {
	pinned?: boolean;
	state?: { pinned?: boolean };
};

type PinnedLeaf = WorkspaceLeaf & {
	pinned?: boolean;
};

function isLeafPinnedForNavigation(
	leaf: WorkspaceLeaf | null | undefined,
): boolean {
	if (!leaf) return false;

	const pinnedLeaf = leaf as PinnedLeaf;
	const viewState = pinnedLeaf.getViewState?.() as
		| PinnedLeafViewState
		| undefined;

	return (
		!!pinnedLeaf.pinned ||
		!!viewState?.pinned ||
		!!viewState?.state?.pinned
	);
}

/**
 * The main-area leaf the user last worked in, in the main window or a pop-out.
 * Obsidian opens a new tab next to this same leaf, so pinned-tab routing looks
 * at the tab a run started from.
 */
export function getOpenFileOriginLeaf(app: App): WorkspaceLeaf | null {
	return app.workspace.getMostRecentLeaf();
}

/**
 * The focused leaf, which can be in a sidebar: what `workspace.activeLeaf`
 * holds, read through the API Obsidian recommends instead of that field.
 */
function getFocusedLeaf(app: App): WorkspaceLeaf | null {
	return app.workspace.getActiveViewOfType(View)?.leaf ?? null;
}

/** Every leaf outside the sidebars: the main window's and each pop-out window's. */
function getMainAreaLeaves(app: App): WorkspaceLeaf[] {
	const { leftSplit, rightSplit } = app.workspace;
	const leaves: WorkspaceLeaf[] = [];
	app.workspace.iterateAllLeaves((leaf: WorkspaceLeaf) => {
		const root = leaf.getRoot();
		if (root !== leftSplit && root !== rightSplit) leaves.push(leaf);
	});
	return leaves;
}

function getLeafParentId(leaf: WorkspaceLeaf): unknown {
	return (leaf.parent as { id?: unknown } | undefined)?.id ?? leaf.parent ?? null;
}

/** An unpinned leaf in another tab group of the origin's own window. */
function findUnpinnedNavigableSibling(
	app: App,
	originLeaf: WorkspaceLeaf,
): WorkspaceLeaf | null {
	const originWindow = originLeaf.getContainer();
	const windowLeaves = getMainAreaLeaves(app).filter(
		(leaf) => leaf.getContainer() === originWindow,
	);
	const originParentId = getLeafParentId(originLeaf);
	const candidates = windowLeaves.filter((leaf) => {
		if (leaf === originLeaf || isLeafPinnedForNavigation(leaf)) return false;
		return originParentId === null || getLeafParentId(leaf) !== originParentId;
	});
	if (candidates.length === 0) return null;

	const originIndex = windowLeaves.indexOf(originLeaf);
	const orderedLeaves =
		originIndex === -1
			? windowLeaves
			: [
					...windowLeaves.slice(originIndex + 1),
					...windowLeaves.slice(0, originIndex),
				];

	return orderedLeaves.find((leaf) => candidates.includes(leaf)) ?? candidates[0];
}

function resolveLeafForOpenFileLocation(
	app: App,
	location: OpenLocation,
	direction: OpenFileOptions["direction"],
	originLeaf: WorkspaceLeaf | null,
): WorkspaceLeaf | null {
	if (
		originLeaf &&
		(location === "tab" || location === "reuse") &&
		isLeafPinnedForNavigation(originLeaf)
	) {
		return (
			findUnpinnedNavigableSibling(app, originLeaf) ??
			app.workspace.getLeaf("tab")
		);
	}

	switch (location) {
		case "reuse":
			return app.workspace.getLeaf(false);
		case "tab":
			return app.workspace.getLeaf("tab");
		case "split":
			return app.workspace.getLeaf("split", direction);
		case "window":
			return app.workspace.getLeaf("window");
		case "left-sidebar":
			return app.workspace.getLeftLeaf(true);
		case "right-sidebar":
			return app.workspace.getRightLeaf(true);
		default:
			return app.workspace.getLeaf("tab");
	}
}

/**
 * Open a file (by TFile or vault path) with precise control over location and mode.
 *
 * @example
 * // Open in a new tab
 * await openFile(app, "daily/2024-01-01.md", { location: "tab" });
 *
 * @example
 * // Split vertically in source mode
 * await openFile(app, file, {
 *   location: "split",
 *   direction: "vertical",
 *   mode: "source"
 * });
 *
 * @example
 * // Open in sidebar without focus
 * await openFile(app, file, {
 *   location: "right-sidebar",
 *   focus: false
 * });
 *
 * @returns The leaf it opened into.
 */
export async function openFile(
	app: App,
	fileOrPath: TFile | string,
	options: OpenFileRuntimeOptions = {}
): Promise<WorkspaceLeaf> {
	const {
		location = DEFAULT_FILE_OPENING.location,
		direction = DEFAULT_FILE_OPENING.direction,
		mode,
		focus = DEFAULT_FILE_OPENING.focus,
		eState,
		originLeaf,
	} = options;

	const file =
		typeof fileOrPath === "string"
			? app.vault.getAbstractFileByPath(fileOrPath)
			: fileOrPath;

	if (!isTFileLike(file)) {
		const fileLabel =
			typeof fileOrPath === "string" ? fileOrPath : fileOrPath.path;
		throw new Error(`File not found: ${fileLabel}`);
	}

	const openOriginLeaf = originLeaf ?? getOpenFileOriginLeaf(app);
	const activeLeaf = !focus ? getFocusedLeaf(app) : null;
	const leaf = resolveLeafForOpenFileLocation(
		app,
		location,
		direction,
		openOriginLeaf,
	);
	if (!leaf) throw new Error("Could not obtain a workspace leaf.");
	if (activeLeaf && getFocusedLeaf(app) !== activeLeaf) {
		app.workspace.setActiveLeaf(activeLeaf, { focus: false });
	}

	// Open the file
	if (focus) {
		await leaf.openFile(file);
	} else {
		await leaf.openFile(file, { active: false });
	}

	// Optionally adjust view mode (Reading / Live Preview / Source)
	if (mode && mode !== "default" && !(typeof mode === "object" && mode.mode === "default")) {
		const vs = leaf.getViewState();
		const next: Record<string, unknown> = { ...(vs.state ?? {}) };

		if (mode === "preview" || (typeof mode === "object" && mode.mode === "preview")) {
			next.mode = "preview";
			delete next.source;
		} else if (mode === "source") {
			next.mode = "source";
			next.source = true;
		} else if (mode === "live" || mode === "live-preview") {
			next.mode = "source";
			next.source = false; // Live Preview = source:false
		} else if (typeof mode === "object" && mode.mode === "source") {
			// advanced override
			next.mode = "source";
			next.source = mode.source;
		}

		// Fix eState usage - merge into state rather than passing as second param
		await leaf.setViewState({
			...vs,
			...(!focus && { active: false }),
			state: { ...next, ...eState },
		});
	}

	if (focus) {
		app.workspace.setActiveLeaf(leaf, { focus: true });
	}

	return leaf;
}

export function areSameVaultFilePath(a: string, b: string): boolean {
	return normalizeVaultPathSeparators(a) === normalizeVaultPathSeparators(b);
}

/**
 * Finds a leaf already displaying `file`, in any window, and optionally focuses
 * it. Prefers the focused leaf, then one in the focused window.
 * Returns the leaf if found, otherwise `null`.
 */
export function openExistingFileTab(
	app: App,
	file: TFile,
	focus = true,
): WorkspaceLeaf | null {
	const focusedLeaf = getFocusedLeaf(app);
	const focusedWindow = focusedLeaf?.getContainer();
	const matches = getMainAreaLeaves(app).filter(({ view }) => {
		if (!(view instanceof FileView) || !view.file) return false;
		return (
			view.file === file || areSameVaultFilePath(file.path, view.file.path)
		);
	});
	const leaf =
		matches.find((match) => match === focusedLeaf) ??
		matches.filter((match) => match.getContainer() === focusedWindow).at(-1) ??
		matches.at(-1);
	if (!leaf) return null;

	if (focus) {
		app.workspace.setActiveLeaf(leaf, { focus: true });
	}
	return leaf;
}
