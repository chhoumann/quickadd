import type { App } from "obsidian";
import { FileIndex } from "src/gui/suggesters/FileIndex";
import type { PickerOrderingDeps } from "./fileOrdering";

/**
 * Builds Quick-Switcher-style ordering deps from the live Obsidian app, defensively:
 * every Obsidian touch is guarded so unit tests with bare app stubs degrade to a
 * stable alphabetical order instead of throwing.
 *
 * Recency reuses the warm FileIndex session-recency (LRU, up to 100) when the index
 * already exists, and always layers app.workspace.getLastOpenFiles() as the
 * cross-session baseline. `isUserIgnored` is a real-but-undocumented Obsidian
 * internal (absent from obsidian.d.ts), so it is reached through a narrow local cast.
 */
export function buildPickerOrderingDeps(app: App): PickerOrderingDeps {
	const recents = app.workspace?.getLastOpenFiles?.() ?? [];
	const recentRank = new Map<string, number>();
	recents.forEach((path, index) => {
		if (!recentRank.has(path)) recentRank.set(path, index);
	});

	let fileIndex: FileIndex | undefined;
	try {
		fileIndex = FileIndex.getInstanceIfExists();
	} catch {
		fileIndex = undefined;
	}

	const metadataCache = app.metadataCache as
		| { isUserIgnored?: (path: string) => boolean }
		| undefined;

	return {
		openedAtOf: (path) => fileIndex?.getLastOpenedAt(path),
		recentRankOf: (path) => recentRank.get(path),
		isExcluded: (path) => metadataCache?.isUserIgnored?.(path) ?? false,
	};
}
