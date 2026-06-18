import type { App, CachedMetadata, TFile } from "obsidian";
import { TFolder } from "obsidian";
import { EnhancedFieldSuggestionFileFilter } from "./EnhancedFieldSuggestionFileFilter";
import type { FieldFilter } from "./FieldSuggestionParser";
import {
	normalizeFrontmatterTagValues,
	normalizeTag,
} from "./tagNormalizer";

export function getAllFolderPathsInVault(app: App): string[] {
	return app.vault
		.getAllLoadedFiles()
		.filter((f) => f instanceof TFolder)
		.map((folder) => folder.path);
}

export function isFolder(app: App, path: string): boolean {
	const abstractItem = app.vault.getAbstractFileByPath(path);

	return !!abstractItem && abstractItem instanceof TFolder;
}

export function getMarkdownFilesInFolder(app: App, folderPath: string): TFile[] {
	return app.vault
		.getMarkdownFiles()
		.filter((f) => f.path.startsWith(folderPath));
}

function getFrontmatterTags(fileCache: CachedMetadata): string[] {
	const frontmatter = fileCache.frontmatter;
	if (!frontmatter) return [];

	// You can have both a 'tag' and 'tags' key in frontmatter.
	const frontMatterValues = Object.entries(frontmatter);
	if (!frontMatterValues.length) return [];

	const tagPairs = frontMatterValues.filter(([key, value]) => {
		const lowercaseKey = key.toLowerCase();

		// In Obsidian, these are synonymous.
		return lowercaseKey === "tags" || lowercaseKey === "tag";
	});

	if (!tagPairs) return [];

	const tags = tagPairs
		.flatMap(([, value]) => normalizeFrontmatterTagValues(value))
		.filter((v) => !!v) as string[]; // fair to cast after filtering out falsy values

	return tags;
}

function getFileTags(app: App, file: TFile): string[] {
	const fileCache = app.metadataCache.getFileCache(file);
	if (!fileCache) return [];

	const tagsInFile: string[] = [];
	if (fileCache.frontmatter) {
		tagsInFile.push(...getFrontmatterTags(fileCache));
	}

	if (fileCache.tags && Array.isArray(fileCache.tags)) {
		tagsInFile.push(...fileCache.tags.map((v) => normalizeTag(v.tag)));
	}

	return tagsInFile;
}

export function getMarkdownFilesWithTag(app: App, tag: string): TFile[] {
	const targetTag = tag.replace(/^#/, "");

	return app.vault.getMarkdownFiles().filter((f: TFile) => {
		const fileTags = getFileTags(app, f);

		return fileTags.includes(targetTag);
	});
}

export function getMarkdownFilesMatchingFilter(
	app: App,
	filter: FieldFilter,
): TFile[] {
	return EnhancedFieldSuggestionFileFilter.filterFiles(
		app.vault.getMarkdownFiles(),
		filter,
		(file) => app.metadataCache.getFileCache(file),
	);
}

/**
 * Whether a frontmatter value equals a (case-insensitive, trimmed) target string.
 * Pure and Obsidian-free so it can be unit-tested directly.
 *
 * - `null`/`undefined` never equals a non-empty target — this also stops the
 *   `String(null) === "null"` coercion trap (an empty `type:` property would
 *   otherwise match `property:type=null`).
 * - Arrays match if ANY element string-coerces to the target (e.g.
 *   `type: [draft, idea]` matches `draft`), mirroring multi-valued tags.
 * - Scalars (string/number/boolean) match by `String(value)` — so `0`/`false`
 *   compare correctly (a naive `if (!value)` would drop them).
 * - Nested objects (non-array) never equality-match a scalar target.
 *
 * Obsidian stores frontmatter dates as strings, so no Date handling is needed.
 */
export function frontmatterValueMatches(raw: unknown, target: string): boolean {
	const normalizedTarget = target.trim().toLowerCase();
	if (raw === null || raw === undefined) return false;
	if (Array.isArray(raw)) {
		return raw.some(
			(element) =>
				element !== null &&
				element !== undefined &&
				typeof element !== "object" &&
				String(element).trim().toLowerCase() === normalizedTarget,
		);
	}
	if (typeof raw === "object") return false;
	return String(raw).trim().toLowerCase() === normalizedTarget;
}

/**
 * Markdown files whose frontmatter matches a property target (issue #466):
 *   - `value === undefined` → presence mode: the file HAS the field (any value,
 *     including an empty/`null` value — Obsidian stores an empty property as `null`).
 *   - otherwise → the field equals `value` (see {@link frontmatterValueMatches}).
 *
 * The field name is matched case-insensitively (Obsidian's metadata cache
 * preserves the author's key case, e.g. `Type`, so a case-sensitive lookup would
 * miss it). An optional {@link FieldFilter} (folder / tag / exclude-*) is applied
 * via the same {@link EnhancedFieldSuggestionFileFilter} used by `{{FILE:}}`, so
 * the pipe-filter grammar behaves identically across features.
 */
export function getMarkdownFilesWithProperty(
	app: App,
	field: string,
	value?: string,
	filter?: FieldFilter,
): TFile[] {
	const targetField = field.trim().toLowerCase();
	if (!targetField) return [];

	let files = app.vault.getMarkdownFiles().filter((f: TFile) => {
		const frontmatter = app.metadataCache.getFileCache(f)?.frontmatter;
		if (!frontmatter) return false;

		const entry = Object.entries(frontmatter).find(
			([key]) => key.toLowerCase() === targetField,
		);
		if (!entry) return false;

		if (value === undefined) return true; // presence mode
		return frontmatterValueMatches(entry[1], value);
	});

	const hasFilter =
		!!filter &&
		(!!filter.folder ||
			!!filter.tags?.length ||
			!!filter.excludeFolders?.length ||
			!!filter.excludeTags?.length ||
			!!filter.excludeFiles?.length);
	if (hasFilter) {
		files = EnhancedFieldSuggestionFileFilter.filterFiles(
			files,
			filter as FieldFilter,
			(file) => app.metadataCache.getFileCache(file),
		);
	}

	return files;
}
