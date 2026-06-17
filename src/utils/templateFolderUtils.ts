import type { App } from "obsidian";
import { TFile } from "obsidian";
import {
	BASE_FILE_EXTENSION_REGEX,
	CANVAS_FILE_EXTENSION_REGEX,
	MARKDOWN_FILE_EXTENSION_REGEX,
} from "../constants";

const EXPLICIT_FILE_EXTENSION_REGEX = /(?:^|\/)[^/.][^/]*\.[^/.]+$/;

/**
 * Whether a path already carries an explicit template source extension.
 * Extensionless paths keep the legacy `.md` default; any explicit extension is
 * read as a text template source so users can keep files like `.eta` templates
 * without renaming them to Markdown.
 */
export function hasTemplateExtension(path: string): boolean {
	return (
		MARKDOWN_FILE_EXTENSION_REGEX.test(path) ||
		CANVAS_FILE_EXTENSION_REGEX.test(path) ||
		BASE_FILE_EXTENSION_REGEX.test(path) ||
		EXPLICIT_FILE_EXTENSION_REGEX.test(path)
	);
}

/**
 * Resolve a template path to its vault file exactly the way the template engine
 * does at run time: strip a leading slash, append `.md` only when no explicit
 * template source extension is present, then look the file up. Returns null when nothing
 * resolves.
 *
 * Single source of truth shared by engine execution, choice-builder validation,
 * and preflight scanning so the three never drift (they previously each had
 * their own near-copy, and the preflight copy skipped the leading-slash strip).
 */
export function getTemplateFile(app: App, templatePath: string): TFile | null {
	const stripped = templatePath.trim().replace(/^\/+/, "");
	if (!stripped) return null;
	const resolved = hasTemplateExtension(stripped) ? stripped : `${stripped}.md`;
	const file = app.vault.getAbstractFileByPath(resolved);
	return file instanceof TFile ? file : null;
}

/**
 * Canonical, order-preserving normalization for the configured template folder
 * list: trims each entry, strips leading/trailing slashes, drops blanks and
 * non-strings, and de-duplicates. Non-array input yields an empty list. Used by
 * both the suggestion query and the package-import default so they never desync.
 */
export function normalizeTemplateFolderPaths(paths: unknown): string[] {
	if (!Array.isArray(paths)) return [];
	const seen = new Set<string>();
	const normalized: string[] = [];
	for (const path of paths) {
		if (typeof path !== "string") continue;
		const folder = path.trim().replace(/^\/+/, "").replace(/\/+$/, "");
		if (!folder || seen.has(folder)) continue;
		seen.add(folder);
		normalized.push(folder);
	}
	return normalized;
}

/**
 * Whether a file path lives within one of the (already normalized) template
 * folders. Boundary-aware: `templates` matches `templates/x.md` but not
 * `templates-old/x.md`. An empty folder list matches everything (the "no
 * folders configured = suggest the whole vault" default).
 */
export function isPathWithinTemplateFolders(
	filePath: string,
	normalizedFolders: string[],
): boolean {
	if (normalizedFolders.length === 0) return true;
	return normalizedFolders.some(
		(folder) => filePath === folder || filePath.startsWith(`${folder}/`),
	);
}
