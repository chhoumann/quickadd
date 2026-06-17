import type { App } from "obsidian";
import { TFile } from "obsidian";

const TEXT_TEMPLATE_SOURCE_EXTENSION_REGEX =
	/\.(?:md|canvas|base|eta|ejs|njk|hbs|handlebars|mustache|txt)$/i;

/**
 * Whether a path already carries a supported template source extension.
 * Extensionless paths keep the legacy `.md` default. Non-native extensions are
 * limited to common text template files so image/CSS/JSON assets in template
 * folders do not become selectable templates.
 */
export function hasTemplateExtension(path: string): boolean {
	return TEXT_TEMPLATE_SOURCE_EXTENSION_REGEX.test(path);
}

/**
 * Resolve a template path to its vault file exactly the way the template engine
 * does at run time: strip a leading slash, append `.md` only when no supported
 * template source extension is present, then look the file up. Returns null
 * when nothing resolves.
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
