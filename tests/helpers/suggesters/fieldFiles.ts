import { TFile, type CachedMetadata, type TagCache } from "obsidian";

export const fieldFile = (path: string): TFile => Object.assign(new TFile(), {
	path,
	name: path.split("/").pop() || "",
	basename: path.split("/").pop()?.split(".")[0] || "",
	extension: path.split(".").pop() || "",
	stat: { ctime: 0, mtime: 0, size: 0 },
	parent: null,
});

export const fieldTag = (tag: string): TagCache => ({
	tag,
	position: {
		start: { line: 0, col: 0, offset: 0 },
		end: { line: 0, col: 0, offset: 0 },
	},
});

export function filterFixture(metadata: Record<string, CachedMetadata | null>) {
	return {
		files: Object.keys(metadata).map(fieldFile),
		getMetadata: (file: TFile) => metadata[file.path] ?? null,
	};
}
