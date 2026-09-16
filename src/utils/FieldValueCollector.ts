import type { App, TFile } from "obsidian";
import { DataviewIntegration } from "./DataviewIntegration";
import { FieldSuggestionFileFilter } from "./FieldSuggestionFileFilter";
import { FieldSuggestionCache } from "./FieldSuggestionCache";
import type { FieldFilter } from "./FieldSuggestionParser";
import { FieldValueProcessor } from "./FieldValueProcessor";
import { InlineFieldParser } from "./InlineFieldParser";

export function generateFieldCacheKey(filters: FieldFilter): string {
	const parts: string[] = [];
	if (filters.folder) parts.push(`folder:${filters.folder}`);
	if (filters.folders?.length) {
		parts.push(`folders:${filters.folders.join(",")}`);
	}
	if (filters.tags) parts.push(`tags:${filters.tags.join(",")}`);
	if (filters.inline) parts.push("inline:true");
	if (filters.inlineCodeBlocks?.length) {
		parts.push(`inline-code-blocks:${filters.inlineCodeBlocks.join(",")}`);
	}
	if (filters.caseSensitive) parts.push("case-sensitive:true");
	if (filters.excludeFolders)
		parts.push(`exclude-folders:${filters.excludeFolders.join(",")}`);
	if (filters.excludeTags)
		parts.push(`exclude-tags:${filters.excludeTags.join(",")}`);
	if (filters.excludeFiles)
		parts.push(`exclude-files:${filters.excludeFiles.join(",")}`);
	if (filters.defaultValue) parts.push(`default:${filters.defaultValue}`);
	if (filters.defaultEmpty) parts.push("default-empty:true");
	if (filters.defaultAlways) parts.push("default-always:true");
	return parts.join("|");
}

export async function collectFieldValuesProcessed(
	app: App,
	fieldName: string,
	filters: FieldFilter,
): Promise<string[]> {
	return (await collectFieldValuesProcessedDetailed(app, fieldName, filters)).values;
}

export async function collectFieldValuesProcessedDetailed(
	app: App,
	fieldName: string,
	filters: FieldFilter,
): Promise<{ values: string[]; hasDefaultValue: boolean }> {
	const rawValues = await collectFieldValuesCached(app, fieldName, filters);

	const processed = FieldValueProcessor.processValues(rawValues, filters);
	return {
		values: processed.values,
		hasDefaultValue: processed.hasDefaultValue,
	};
}

async function collectFieldValuesCached(
	app: App,
	fieldName: string,
	filters: FieldFilter,
): Promise<Set<string>> {
	const cache = FieldSuggestionCache.getInstance();
	const cacheKey = generateFieldCacheKey(filters);
	const cachedValues = cache.get(fieldName, cacheKey);
	if (cachedValues) return cachedValues;

	const revision = cache.getRevision();
	const collectedValues = await collectFieldValuesRaw(app, fieldName, filters);
	// A metadata event may fire while the async vault scan is in progress. Do not
	// let that older scan repopulate the cache after the event cleared it; the next
	// input refresh will scan the now-current vault state again.
	cache.setIfRevision(fieldName, collectedValues, cacheKey, revision);
	return collectedValues;
}

export async function collectFieldValuesRaw(
	app: App,
	fieldName: string,
	filters: FieldFilter,
): Promise<Set<string>> {
	const normalizedFieldName = fieldName.trim().toLowerCase();
	if (normalizedFieldName === "tags" || normalizedFieldName === "tag") {
		const tagValues = await collectTagValues(app, filters);
		if (tagValues.size > 0) return tagValues;
	}

	// Try Dataview when allowed; fall back to manual collection. Dataview's query
	// builder can't express exclude-file, but getFieldValuesWithFilter now applies
	// it by dropping excluded files' rows, so the Dataview path is kept (with its
	// richer value parsing — comma-splitting, link/file objects) even when an
	// exclude-file filter is present. Only the inline path still bypasses Dataview
	// (inline fields aren't in Dataview's metadata).
	try {
		if (!filters.inline && DataviewIntegration.isAvailable(app)) {
			const dvValues = await DataviewIntegration.getFieldValuesWithFilter(
				app,
				fieldName,
				filters,
			);
			if (dvValues.size > 0) return dvValues;
		}
	} catch {
		// ignore and fall back
	}

	return await collectFieldValuesManually(app, fieldName, filters);
}

async function collectTagValues(app: App, filters: FieldFilter): Promise<Set<string>> {
	const hasFileFilters =
		Boolean(filters.folder) ||
		Boolean(filters.folders?.length) ||
		Boolean(filters.tags?.length) ||
		Boolean(filters.excludeFolders?.length) ||
		Boolean(filters.excludeTags?.length) ||
		Boolean(filters.excludeFiles?.length);

	if (!hasFileFilters) {
		const fromIndex = collectAllVaultTags(app);
		if (fromIndex.size > 0) return fromIndex;
	}

	return await collectTagValuesFromFiles(app, filters);
}

function collectAllVaultTags(app: App): Set<string> {
	const values = new Set<string>();

	try {
		// @ts-expect-error - getTags exists in Obsidian but is not typed
		const tagObj = app.metadataCache.getTags?.() as
			| Record<string, number>
			| undefined;

		if (!tagObj) return values;

		for (const rawTag of Object.keys(tagObj)) {
			const cleaned = rawTag.startsWith("#") ? rawTag.substring(1) : rawTag;
			const tag = cleaned.trim();
			if (tag) values.add(tag);
		}
	} catch {
		// ignore and fall back to file-based collection
	}

	return values;
}

function addValues(values: Set<string>, source: unknown): void {
	if (source === undefined || source === null) return;
	for (const value of Array.isArray(source) ? source : [source]) {
		const text = String(value).trim();
		if (text) values.add(text);
	}
}

async function collectFromFiles(
	app: App,
	filters: FieldFilter,
	collect: (file: TFile, values: Set<string>) => Promise<void> | void,
): Promise<Set<string>> {
	const values = new Set<string>();
	const files = FieldSuggestionFileFilter.filterFiles(
		app.vault.getMarkdownFiles(), filters,
		(file) => app.metadataCache.getFileCache(file),
	);
	// Bound concurrent reads and merge in vault order, regardless of completion order.
	for (let i = 0; i < files.length; i += 50) {
		const results = await Promise.all(files.slice(i, i + 50).map(async (file) => {
			const collected = new Set<string>();
			try {
				await collect(file, collected);
			} catch {
				// Preserve values collected before an unreadable field or file.
			}
			return collected;
		}));
		for (const collected of results) {
			for (const value of collected) values.add(value);
		}
	}
	return values;
}

async function collectTagValuesFromFiles(
	app: App,
	filters: FieldFilter,
): Promise<Set<string>> {
	return collectFromFiles(app, filters, (file, values) => {
		const metadata = app.metadataCache.getFileCache(file);
		addValues(values, metadata?.frontmatter?.tags);
		addValues(values, metadata?.frontmatter?.tag);
		for (const entry of metadata?.tags ?? []) {
			const tag = String(entry.tag ?? "").trim().replace(/^#/, "");
			if (tag) values.add(tag);
		}
	});
}

async function collectFieldValuesManually(
	app: App,
	fieldName: string,
	filters: FieldFilter,
): Promise<Set<string>> {
	return collectFromFiles(app, filters, async (file, values) => {
		const field: unknown = app.metadataCache.getFileCache(file)?.frontmatter?.[fieldName];
		if (Array.isArray(field)) {
			field.forEach(value => addValues(values, [value]));
		} else if (typeof field !== "object") {
			addValues(values, field);
		}
		if (filters.inline) {
			const content = await app.vault.read(file);
			addValues(values, [...InlineFieldParser.getFieldValues(content, fieldName, {
				includeCodeBlocks: filters.inlineCodeBlocks,
			})]);
		}
	});
}
