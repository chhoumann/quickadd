import { normalizePath } from "obsidian";

export function basenameWithoutMdOrCanvas(path: string): string {
	const normalized = normalizePath(path);
	const base = normalized.split("/").pop() ?? "";
	return base.replace(/\.(md|canvas)$/i, "");
}
