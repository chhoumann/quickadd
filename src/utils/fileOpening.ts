import type { App, WorkspaceLeaf, WorkspaceParent } from "obsidian";
import { FileView, normalizePath, TFile } from "obsidian";
import type {
	OpenLocation as FileOpenLocation,
	OpenFileOptions as FileOpenOptions,
	FileViewMode2 as FileViewModeNew,
} from "../types/fileOpening";

// Re-export types for convenience
export type OpenLocation = FileOpenLocation;
export type FileViewMode2 = FileViewModeNew;
export type OpenFileOptions = FileOpenOptions;

export type OpenFileRuntimeOptions = FileOpenOptions & {
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

type WorkspaceWithOriginLeaf = App["workspace"] & {
	rootSplit?: WorkspaceParent;
	getMostRecentLeaf?: (root?: WorkspaceParent) => WorkspaceLeaf | null;
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

export function getOpenFileOriginLeaf(app: App): WorkspaceLeaf | null {
	const workspace = app.workspace as WorkspaceWithOriginLeaf;
	const rootLeaf = workspace.rootSplit
		? workspace.getMostRecentLeaf?.(workspace.rootSplit)
		: null;

	// `getMostRecentLeaf()` already returns the active main-area leaf, superseding
	// the deprecated `workspace.activeLeaf` that used to be the final fallback.
	return rootLeaf ?? workspace.getMostRecentLeaf?.() ?? null;
}

function getRootLeaves(app: App): WorkspaceLeaf[] {
	const leaves: WorkspaceLeaf[] = [];
	app.workspace.iterateRootLeaves((leaf: WorkspaceLeaf) => {
		if (!leaves.includes(leaf)) leaves.push(leaf);
	});
	return leaves;
}

function getLeafParentId(leaf: WorkspaceLeaf): unknown {
	return (leaf.parent as { id?: unknown } | undefined)?.id ?? leaf.parent ?? null;
}

function findUnpinnedNavigableSibling(
	rootLeaves: WorkspaceLeaf[],
	originLeaf: WorkspaceLeaf,
): WorkspaceLeaf | null {
	const originParentId = getLeafParentId(originLeaf);
	const candidates = rootLeaves.filter((leaf) => {
		if (leaf === originLeaf || isLeafPinnedForNavigation(leaf)) return false;
		return originParentId === null || getLeafParentId(leaf) !== originParentId;
	});
	if (candidates.length === 0) return null;

	const originIndex = rootLeaves.indexOf(originLeaf);
	const orderedLeaves =
		originIndex === -1
			? rootLeaves
			: [
					...rootLeaves.slice(originIndex + 1),
					...rootLeaves.slice(0, originIndex),
				];

	return orderedLeaves.find((leaf) => candidates.includes(leaf)) ?? candidates[0];
}

function isTFileLike(file: unknown): file is TFile {
	if (file instanceof TFile) return true;
	return (
		typeof file === "object" &&
		file !== null &&
		"path" in file &&
		typeof file.path === "string"
	);
}

function resolveLeafForOpenFileLocation(
	app: App,
	location: FileOpenLocation,
	direction: FileOpenOptions["direction"],
	originLeaf: WorkspaceLeaf | null,
): WorkspaceLeaf | null {
	if (
		originLeaf &&
		(location === "tab" || location === "reuse") &&
		isLeafPinnedForNavigation(originLeaf)
	) {
		const siblingLeaf = findUnpinnedNavigableSibling(
			getRootLeaves(app),
			originLeaf,
		);
		return siblingLeaf ?? app.workspace.getLeaf("tab");
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
		location = "tab",
		direction = "vertical",
		mode,
		focus = true,
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
	const leaf = resolveLeafForOpenFileLocation(
		app,
		location,
		direction,
		openOriginLeaf,
	);
	if (!leaf) throw new Error("Could not obtain a workspace leaf.");

	// Open the file
	await leaf.openFile(file);

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
		await leaf.setViewState({ ...vs, state: { ...next, ...eState } });
	}

	if (focus) {
		app.workspace.setActiveLeaf(leaf, { focus: true });
	}

	return leaf;
}

export function normalizeVaultFilePath(path: string): string {
	const normalized = normalizePath(path).replace(/\/{2,}/g, "/");
	return normalized.replace(/^\/+/, "");
}

export function areSameVaultFilePath(a: string, b: string): boolean {
	return normalizeVaultFilePath(a) === normalizeVaultFilePath(b);
}

/**
 * Finds an already-open leaf that is displaying `file` and optionally focuses it.
 * Returns the leaf if found, otherwise `null`.
 */
export function openExistingFileTab(
	app: App,
	file: TFile,
	focus = true,
): WorkspaceLeaf | null {
	let leaf: WorkspaceLeaf | undefined = undefined;

	app.workspace.iterateRootLeaves((m_leaf: WorkspaceLeaf) => {
		const view = m_leaf.view;
		if (view instanceof FileView) {
			if (view.file) {
				if (
					view.file === file ||
					areSameVaultFilePath(file.path, view.file.path)
				) {
					leaf = m_leaf;
					return;
				}
			}
		}
	});
	if (leaf !== undefined) {
		if (focus) {
			app.workspace.setActiveLeaf(leaf, { focus: true });
		}
		return leaf;
	}
	return null;
}
