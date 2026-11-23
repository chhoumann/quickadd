import { isPathWithinFolder, normalizeVaultPath } from "./pathUtils";

const folderPathSegmentCollator = new Intl.Collator(undefined, {
	numeric: true,
	sensitivity: "base",
});

const folderPathSegmentFallbackCollator = new Intl.Collator(undefined, {
	numeric: true,
	sensitivity: "variant",
});

function compareFolderPathsByTree(a: string, b: string): number {
	const normalizedA = normalizeVaultPath(a);
	const normalizedB = normalizeVaultPath(b);

	if (normalizedA === normalizedB) return 0;

	const segmentsA = normalizedA === "" ? [] : normalizedA.split("/");
	const segmentsB = normalizedB === "" ? [] : normalizedB.split("/");
	const segmentCount = Math.min(segmentsA.length, segmentsB.length);

	for (let i = 0; i < segmentCount; i++) {
		const primary = folderPathSegmentCollator.compare(
			segmentsA[i],
			segmentsB[i],
		);
		if (primary !== 0) return primary;

		const fallback = folderPathSegmentFallbackCollator.compare(
			segmentsA[i],
			segmentsB[i],
		);
		if (fallback !== 0) return fallback;
	}

	return segmentsA.length - segmentsB.length;
}

export function sortFolderPathsByTree(paths: string[]): string[] {
	return [...paths].sort(compareFolderPathsByTree);
}

/**
 * Keep each root's subtree in vault tree order, but emit those blocks in
 * configured-root order. Overlapping roots skip paths already emitted.
 */
export function orderFolderPathsByConfiguredRoots(
	treeSortedPaths: readonly string[],
	roots: readonly string[],
): string[] {
	const result: string[] = [];
	const seen = new Set<string>();
	for (const root of roots) {
		for (const path of treeSortedPaths) {
			if (seen.has(path)) continue;
			if (!isPathWithinFolder(path, root)) continue;
			result.push(path);
			seen.add(path);
		}
	}
	return result;
}
