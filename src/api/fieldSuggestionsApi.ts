import type { App } from "obsidian";
import { FieldSuggestionCache } from "../utils/FieldSuggestionCache";
import { FieldSuggestionFileFilter } from "../utils/FieldSuggestionFileFilter";
import { InlineFieldParser } from "../utils/InlineFieldParser";

export function createFieldSuggestionsApi(app: App) {
	return {
		getFieldValues: async (
			fieldName: string,
			options?: {
				folder?: string;
				folders?: string[];
				tags?: string[];
				includeInline?: boolean;
				includeInlineCodeBlocks?: string[];
			},
		) => {
			const inlineCodeBlocks = options?.includeInlineCodeBlocks
				?.map((value) => value.trim().toLowerCase())
				.filter((value) => value.length > 0);
			const filters = {
				folder: options?.folder,
				folders: options?.folders,
				tags: options?.tags,
				inline: options?.includeInline ?? false,
				inlineCodeBlocks,
			};

			// Get all markdown files and apply filters
			let files = app.vault.getMarkdownFiles();
			files = FieldSuggestionFileFilter.filterFiles(
				files,
				filters,
				(file) => app.metadataCache.getFileCache(file),
			);

			const values = new Set<string>();

			// Collect field values from filtered files
			for (const file of files) {
				const cache = app.metadataCache.getFileCache(file);

				// Get values from YAML frontmatter
				const value = cache?.frontmatter?.[fieldName];
				if (value !== undefined && value !== null) {
					if (Array.isArray(value)) {
						// Skip null/undefined and nested objects before
						// stringifying - String(null) is "null" and an
						// object yields "[object Object]"; both are noise.
						value.forEach((x) => {
							if (x === undefined || x === null) return;
							if (typeof x === "object") return;
							const strValue = String(x).trim();
							if (strValue) values.add(strValue);
						});
					} else if (typeof value !== "object") {
						const strValue = String(value).trim();
						if (strValue) values.add(strValue);
					}
				}

				// Get values from inline fields if requested
				if (filters.inline) {
					// One unreadable file must not abort the whole call;
					// skip it (mirrors FieldValueCollector).
					try {
						const content = await app.vault.read(file);
						const inlineValues = InlineFieldParser.getFieldValues(
							content,
							fieldName,
							{
								includeCodeBlocks: inlineCodeBlocks,
							},
						);
						inlineValues.forEach((v) => values.add(v));
					} catch {
						// Ignore files whose contents cannot be read.
					}
				}
			}

			return Array.from(values).sort();
		},
		clearCache: (fieldName?: string) => {
			const cache = FieldSuggestionCache.getInstance();
			cache.clear(fieldName);
		},
	};
}
