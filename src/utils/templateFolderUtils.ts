import type { App } from "obsidian";
import { TFile } from "obsidian";
import {
	BASE_FILE_EXTENSION_REGEX,
	CANVAS_FILE_EXTENSION_REGEX,
	MARKDOWN_FILE_EXTENSION_REGEX,
} from "../constants";

const NATIVE_TEMPLATE_OUTPUT_EXTENSIONS = ["md", "canvas", "base"] as const;
export const DEFAULT_ADDITIONAL_TEMPLATE_SOURCE_EXTENSIONS = ["eta"] as const;
const EXTENSION_SEGMENT_REGEX = /^[a-z0-9][a-z0-9_-]*$/i;

function escapeRegExp(value: string): string {
	return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function normalizeExtension(extension: string): string | null {
	const normalized = extension.trim().replace(/^\.+/, "").toLowerCase();
	if (!normalized || !EXTENSION_SEGMENT_REGEX.test(normalized)) return null;
	return normalized;
}

/**
 * Normalizes the user-configurable list of extra template source extensions.
 * Accepts either an array (the persisted shape) or comma/whitespace-separated
 * text (used by the settings UI).
 */
export function normalizeTemplateSourceExtensions(input: unknown): string[] {
	const rawEntries = Array.isArray(input)
		? input
		: typeof input === "string"
			? input.split(/[\s,]+/)
			: [];

	const seen = new Set<string>();
	const extensions: string[] = [];
	for (const entry of rawEntries) {
		if (typeof entry !== "string") continue;
		const extension = normalizeExtension(entry);
		if (!extension) continue;
		if (NATIVE_TEMPLATE_OUTPUT_EXTENSIONS.includes(
			extension as (typeof NATIVE_TEMPLATE_OUTPUT_EXTENSIONS)[number],
		)) {
			continue;
		}
		if (seen.has(extension)) continue;
		seen.add(extension);
		extensions.push(extension);
	}

	return extensions;
}

export function getTemplateSourceExtensions(
	additionalExtensions: unknown,
): string[] {
	const extra =
		additionalExtensions === undefined
			? DEFAULT_ADDITIONAL_TEMPLATE_SOURCE_EXTENSIONS
			: additionalExtensions;
	return [
		...NATIVE_TEMPLATE_OUTPUT_EXTENSIONS,
		...normalizeTemplateSourceExtensions(extra),
	];
}

/**
 * Whether a path already carries a template extension the engine can read
 * (`.md`/`.canvas`/`.base`, plus configured source-only extensions such as
 * `.eta`). Source-only extensions are read as templates but do not determine
 * the extension of files created from them.
 */
export function hasTemplateExtension(
	path: string,
	additionalExtensions?: unknown,
): boolean {
	return getTemplateSourceExtensions(additionalExtensions).some((extension) =>
		new RegExp(`\\.${escapeRegExp(extension)}$`, "i").test(path),
	);
}

export function getTemplateOutputExtension(templatePath: string): ".md" | ".canvas" | ".base" {
	if (CANVAS_FILE_EXTENSION_REGEX.test(templatePath)) return ".canvas";
	if (BASE_FILE_EXTENSION_REGEX.test(templatePath)) return ".base";
	return ".md";
}

export function stripTemplateOutputExtension(path: string): string {
	return path
		.replace(MARKDOWN_FILE_EXTENSION_REGEX, "")
		.replace(CANVAS_FILE_EXTENSION_REGEX, "")
		.replace(BASE_FILE_EXTENSION_REGEX, "");
}

export function buildTemplateInclusionRegex(
	additionalExtensions?: unknown,
	flags = "i",
): RegExp {
	const extensions = getTemplateSourceExtensions(additionalExtensions)
		.map(escapeRegExp)
		.join("|");
	return new RegExp(
		`{{TEMPLATE:([^\\n\\r}]*\\.(?:${extensions}))}}`,
		flags,
	);
}

/**
 * Resolve a template path to its vault file exactly the way the template engine
 * does at run time: strip a leading slash, append `.md` when no configured
 * template source extension is present, then look the file up. Returns null
 * when nothing resolves.
 *
 * Single source of truth shared by engine execution, choice-builder validation,
 * and preflight scanning so the three never drift (they previously each had
 * their own near-copy, and the preflight copy skipped the leading-slash strip).
 */
export function getTemplateFile(
	app: App,
	templatePath: string,
	additionalExtensions?: unknown,
): TFile | null {
	const stripped = templatePath.trim().replace(/^\/+/, "");
	if (!stripped) return null;
	const resolved = hasTemplateExtension(stripped, additionalExtensions)
		? stripped
		: `${stripped}.md`;
	const file = app.vault.getAbstractFileByPath(resolved);
	if (file instanceof TFile) return file;

	// Backward compatibility: before source-only extensions were recognized,
	// a path like "Templates/Daily.eta" resolved to "Templates/Daily.eta.md".
	// Preserve that alias when no exact source file exists.
	if (
		resolved === stripped &&
		getTemplateOutputExtension(stripped) === ".md" &&
		!MARKDOWN_FILE_EXTENSION_REGEX.test(stripped)
	) {
		const markdownFallback = app.vault.getAbstractFileByPath(`${stripped}.md`);
		return markdownFallback instanceof TFile ? markdownFallback : null;
	}

	return null;
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
