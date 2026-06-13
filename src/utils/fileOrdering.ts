import type { TFile } from "obsidian";

/**
 * Injected, Obsidian-free inputs for ordering a note-picker candidate list the
 * way Obsidian's Quick Switcher does. Kept as plain functions so the ordering
 * logic stays unit-testable without the Obsidian runtime.
 */
export interface PickerOrderingDeps {
	/**
	 * Session recency timestamp (ms epoch) for a path, from the warm FileIndex,
	 * or undefined when the file has not been opened this session / the index is cold.
	 */
	openedAtOf?: (path: string) => number | undefined;
	/**
	 * Cross-session recency rank for a path (0 = most recent), from
	 * app.workspace.getLastOpenFiles(). The always-available baseline used before
	 * (and alongside) the session-recency index.
	 */
	recentRankOf?: (path: string) => number | undefined;
	/** Obsidian "Excluded files" predicate (app.metadataCache.isUserIgnored). */
	isExcluded?: (path: string) => boolean;
}

/**
 * Orders files for a capture note-picker to mirror the Quick Switcher:
 *  1. excluded ("Excluded files") sink to the bottom but stay selectable,
 *  2. most-recently-opened first (session recency, then cross-session recents),
 *  3. everything else alphabetically — a predictable tail that never re-surfaces
 *     the sync/import noise that motivated issue #745 (deliberately not mtime).
 *
 * Pure: all Obsidian access is injected via {@link PickerOrderingDeps}, so the
 * empty-deps case degrades to a stable alphabetical order.
 */
export function orderFilesForPicker(
	files: TFile[],
	deps: PickerOrderingDeps = {},
): TFile[] {
	const { openedAtOf, recentRankOf, isExcluded } = deps;

	return files
		.map((file) => ({
			file,
			name: file.basename || file.path,
			excluded: isExcluded?.(file.path) ?? false,
			openedAt: openedAtOf?.(file.path),
			recentRank: recentRankOf?.(file.path),
		}))
		.sort((a, b) => {
			// 1. Excluded files always sink (but remain selectable).
			if (a.excluded !== b.excluded) return a.excluded ? 1 : -1;

			// 2a. Session recency (FileIndex): opened-this-session first, newest first.
			const aOpened = a.openedAt != null;
			const bOpened = b.openedAt != null;
			if (aOpened !== bOpened) return aOpened ? -1 : 1;
			if (aOpened && bOpened && a.openedAt !== b.openedAt) {
				return (b.openedAt as number) - (a.openedAt as number);
			}

			// 2b. Cross-session recents (getLastOpenFiles): lower rank = more recent.
			const aRank = a.recentRank ?? Number.POSITIVE_INFINITY;
			const bRank = b.recentRank ?? Number.POSITIVE_INFINITY;
			if (aRank !== bRank) return aRank - bRank;

			// 3. Predictable alphabetical tail.
			return a.name.localeCompare(b.name);
		})
		.map((entry) => entry.file);
}
