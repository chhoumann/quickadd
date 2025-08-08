import type { App, TFile } from "obsidian";
import { DataviewIntegration } from "./DataviewIntegration";
import { EnhancedFieldSuggestionFileFilter } from "./EnhancedFieldSuggestionFileFilter";
import { FieldSuggestionCache } from "./FieldSuggestionCache";
import type { FieldFilter } from "./FieldSuggestionParser";
import { FieldValueProcessor } from "./FieldValueProcessor";
import { InlineFieldParser } from "./InlineFieldParser";

export function generateFieldCacheKey(filters: FieldFilter): string {
	const parts: string[] = [];
	if (filters.folder) parts.push(`folder:${filters.folder}`);
	if (filters.tags) parts.push(`tags:${filters.tags.join(",")}`);
	if (filters.inline) parts.push("inline:true");
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
	const cache = FieldSuggestionCache.getInstance();
	const cacheKey = generateFieldCacheKey(filters);
	let rawValues = cache.get(fieldName, cacheKey);
	if (!rawValues) {
		rawValues = await collectFieldValuesRaw(app, fieldName, filters);
		cache.set(fieldName, rawValues, cacheKey);
	}

	const processed = FieldValueProcessor.processValues(rawValues, filters);
	return processed.values;
}

export async function collectFieldValuesProcessedDetailed(
	app: App,
	fieldName: string,
	filters: FieldFilter,
): Promise<{ values: string[]; hasDefaultValue: boolean }> {
	const cache = FieldSuggestionCache.getInstance();
	const cacheKey = generateFieldCacheKey(filters);
	let rawValues = cache.get(fieldName, cacheKey);
	if (!rawValues) {
		rawValues = await collectFieldValuesRaw(app, fieldName, filters);
		cache.set(fieldName, rawValues, cacheKey);
	}

	const processed = FieldValueProcessor.processValues(rawValues, filters);
	return {
		values: processed.values,
		hasDefaultValue: processed.hasDefaultValue,
	};
}

export async function collectFieldValuesRaw(
	app: App,
	fieldName: string,
	filters: FieldFilter,
): Promise<Set<string>> {
	// Try Dataview when allowed; fall back to manual collection
	try {
		if (!filters.inline && DataviewIntegration.isAvailable(app)) {
			const dvValues = await DataviewIntegration.getFieldValuesWithFilter(
				app,
				fieldName,
				filters.folder,
				filters.tags,
				filters.excludeFolders,
				filters.excludeTags,
			);
			if (dvValues.size > 0) return dvValues;
		}
	} catch {
		// ignore and fall back
	}

	return await collectFieldValuesManually(app, fieldName, filters);
}

async function collectFieldValuesManually(
	app: App,
	fieldName: string,
	filters: FieldFilter,
): Promise<Set<string>> {
	const rawValues = new Set<string>();

	// Get all markdown files and apply enhanced filtering
	let files = app.vault.getMarkdownFiles();
	files = EnhancedFieldSuggestionFileFilter.filterFiles(
		files,
		filters,
		(file: TFile) => app.metadataCache.getFileCache(file),
	);

	// Process files in batches
	const batchSize = 50;
	for (let i = 0; i < files.length; i += batchSize) {
		const batch = files.slice(i, i + batchSize);
		const promises = batch.map(async (file) => {
			const values = new Set<string>();
			try {
				const metadataCache = app.metadataCache.getFileCache(file);
				// YAML frontmatter
				const v: unknown = metadataCache?.frontmatter?.[fieldName];
				if (v !== undefined && v !== null) {
					if (Array.isArray(v)) {
						v.forEach((x) => {
							const s = String(x).trim();
							if (s) values.add(s);
						});
					} else if (typeof v !== "object") {
						const s = String(v).trim();
						if (s) values.add(s);
					}
				}

				// Inline fields
				if (filters.inline) {
					try {
						const content = await app.vault.read(file);
						const inlineValues = InlineFieldParser.getFieldValues(
							content,
							fieldName,
						);
						inlineValues.forEach((s) => {
							const t = String(s).trim();
							if (t) values.add(t);
						});
					} catch {}
				}
			} catch {}
			return values;
		});

		const batchResults = await Promise.all(promises);
		for (const set of batchResults) {
			for (const v of set) rawValues.add(v);
		}
	}

	return rawValues;
}
