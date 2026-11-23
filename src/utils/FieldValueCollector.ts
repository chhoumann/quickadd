import type { App, TFile } from "obsidian";
import { FieldSuggestionFileFilter } from "./FieldSuggestionFileFilter";
import { FieldSuggestionCache } from "./FieldSuggestionCache";
import type { FieldFilter } from "./FieldSuggestionParser";
import { isRelativeLinkTarget, linkTargetOf } from "./fieldLinkValues";
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

export interface SourcedFieldValue {
	value: string;
	sourcePath?: string;
}

const sourcedFieldCaches = new WeakMap<
	App,
	{ revision: number; entries: Map<string, SourcedFieldValue[]> }
>();

export async function collectFieldValuesWithSource(
	app: App,
	fieldName: string,
	filters: FieldFilter,
): Promise<{ values: SourcedFieldValue[]; hasDefaultValue: boolean }> {
	const rawEntries = await collectFieldValuesWithSourceCached(app, fieldName, filters);
	const entries = rawEntries.filter(
		(entry) => !FieldValueProcessor.isUnresolvedFieldToken(entry.value),
	);
	return applySourcedDefaultValue(entries, filters);
}

async function collectFieldValuesWithSourceCached(
	app: App,
	fieldName: string,
	filters: FieldFilter,
): Promise<SourcedFieldValue[]> {
	const cache = FieldSuggestionCache.getInstance();
	const revision = cache.getRevision();
	const key = JSON.stringify([fieldName, generateFieldCacheKey(filters) || null]);
	const appCache = sourcedFieldCaches.get(app);
	if (appCache && appCache.revision === revision) {
		const hit = appCache.entries.get(key);
		if (hit) return [...hit];
	}

	const entries = await collectFieldValuesWithSourceRaw(app, fieldName, filters);
	if (cache.getRevision() === revision) {
		let current = sourcedFieldCaches.get(app);
		if (!current || current.revision !== revision) {
			current = { revision, entries: new Map() };
			sourcedFieldCaches.set(app, current);
		}
		current.entries.set(key, entries);
	}
	return [...entries];
}

async function collectFieldValuesWithSourceRaw(
	app: App,
	fieldName: string,
	filters: FieldFilter,
): Promise<SourcedFieldValue[]> {
	const normalizedFieldName = fieldName.trim().toLowerCase();
	if (normalizedFieldName === "tags" || normalizedFieldName === "tag") {
		const tagEntries = await collectEntriesFromFiles(app, filters, (file, values) => {
			collectFileTagValues(app, file, values);
		});
		if (tagEntries.length > 0) return tagEntries;
	}

	return await collectEntriesFromFiles(app, filters, (file, values) =>
		collectFileFieldValues(app, file, fieldName, filters, values),
	);
}

function applySourcedDefaultValue(
	entries: SourcedFieldValue[],
	filters: FieldFilter,
): { values: SourcedFieldValue[]; hasDefaultValue: boolean } {
	if (!filters.defaultValue) {
		return { values: entries, hasDefaultValue: false };
	}

	const defaultEntry: SourcedFieldValue = { value: filters.defaultValue };
	const relativeDefault = isRelativeLinkTarget(linkTargetOf(defaultEntry.value));
	const isPresent = (entry: SourcedFieldValue): boolean =>
		FieldValueProcessor.valuesMatch(entry.value, defaultEntry.value, filters.caseSensitive) &&
		(!relativeDefault || entry.sourcePath === undefined);

	if (filters.defaultAlways) {
		return {
			values: [defaultEntry, ...entries],
			hasDefaultValue: true,
		};
	}
	if (filters.defaultEmpty) {
		return entries.length === 0
			? { values: [defaultEntry], hasDefaultValue: true }
			: { values: entries, hasDefaultValue: false };
	}
	if (!entries.some(isPresent)) {
		return { values: [defaultEntry, ...entries], hasDefaultValue: true };
	}
	return { values: entries, hasDefaultValue: false };
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

async function collectEntriesFromFiles(
	app: App,
	filters: FieldFilter,
	collect: (file: TFile, values: Set<string>) => Promise<void> | void,
): Promise<SourcedFieldValue[]> {
	const entries: SourcedFieldValue[] = [];
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
			return { sourcePath: file.path, collected };
		}));
		for (const { sourcePath, collected } of results) {
			for (const value of collected) entries.push({ value, sourcePath });
		}
	}
	return entries;
}

async function collectFromFiles(
	app: App,
	filters: FieldFilter,
	collect: (file: TFile, values: Set<string>) => Promise<void> | void,
): Promise<Set<string>> {
	const entries = await collectEntriesFromFiles(app, filters, collect);
	return new Set(entries.map((entry) => entry.value));
}

function collectFileTagValues(app: App, file: TFile, values: Set<string>): void {
	const metadata = app.metadataCache.getFileCache(file);
	addValues(values, metadata?.frontmatter?.tags);
	addValues(values, metadata?.frontmatter?.tag);
	for (const entry of metadata?.tags ?? []) {
		const tag = String(entry.tag ?? "").trim().replace(/^#/, "");
		if (tag) values.add(tag);
	}
}

async function collectFileFieldValues(
	app: App,
	file: TFile,
	fieldName: string,
	filters: FieldFilter,
	values: Set<string>,
): Promise<void> {
	const field: unknown = app.metadataCache.getFileCache(file)?.frontmatter?.[fieldName];
	if (Array.isArray(field)) {
		field.forEach(value => addValues(values, [value]));
	} else if (typeof field !== "object") {
		addValues(values, field);
	}
	if (filters.inline) {
		const content = await app.vault.cachedRead(file);
		addValues(values, [...InlineFieldParser.getFieldValues(content, fieldName, {
			includeCodeBlocks: filters.inlineCodeBlocks,
		})]);
	}
}

async function collectTagValuesFromFiles(
	app: App,
	filters: FieldFilter,
): Promise<Set<string>> {
	return collectFromFiles(app, filters, (file, values) => {
		collectFileTagValues(app, file, values);
	});
}

async function collectFieldValuesManually(
	app: App,
	fieldName: string,
	filters: FieldFilter,
): Promise<Set<string>> {
	return collectFromFiles(app, filters, (file, values) =>
		collectFileFieldValues(app, file, fieldName, filters, values),
	);
}
