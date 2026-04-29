const folderPathSegmentCollator = new Intl.Collator(undefined, {
	numeric: true,
	sensitivity: "base",
});

const folderPathSegmentFallbackCollator = new Intl.Collator(undefined, {
	numeric: true,
	sensitivity: "variant",
});

function normalizeFolderSortPath(path: string): string {
	return path.trim().replace(/^\/+/, "").replace(/\/+$/, "");
}

function compareFolderPathsByTree(a: string, b: string): number {
	const normalizedA = normalizeFolderSortPath(a);
	const normalizedB = normalizeFolderSortPath(b);

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

export function isFolderPathWithinRoot(path: string, root: string): boolean {
	const normalizedPath = normalizeFolderSortPath(path);
	const normalizedRoot = normalizeFolderSortPath(root);

	if (!normalizedRoot) return true;
	return (
		normalizedPath === normalizedRoot ||
		normalizedPath.startsWith(`${normalizedRoot}/`)
	);
}

export function filterFolderPathsWithinRoots(
	paths: string[],
	roots: string[],
): string[] {
	return paths.filter((path) =>
		roots.some((root) => isFolderPathWithinRoot(path, root)),
	);
}
