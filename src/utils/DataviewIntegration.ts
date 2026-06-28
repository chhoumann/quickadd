import type { App } from "obsidian";
import { getAPI } from "obsidian-dataview";
import { log } from "src/logger/logManager";
import type { FieldFilter } from "./FieldSuggestionParser";

type DataviewFileLike = { path: string };

// Minimal structural surface of the Dataview API actually used here. Declaring it
// locally decouples this integration from `obsidian-dataview`'s exported
// `DataviewApi` type, which resolves to `any` and made the `DataviewApi | null`
// return type a redundant union.
type DataviewQueryApi = {
	query(source: string): Promise<{
		successful: boolean;
		value: { values: unknown[][] };
	}>;
};

function escapeDataviewString(value: string): string {
	return value.replace(/[\\"]/g, "\\$&");
}

function escapeRegex(value: string): string {
	return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// A folder is embedded into a regex pattern that itself lives inside a DQL
// double-quoted string literal: regexmatch("^<folder>/", file.path). It must be
// escaped for BOTH contexts: escapeRegex neutralizes regex metacharacters but
// NOT the double-quote that would terminate the DQL string early, so wrap the
// result with escapeDataviewString. Order matters - regex first (so the pattern
// is correct), then DQL (so the backslashes/quotes survive the string lexer).
function escapeRegexForDataviewString(value: string): string {
	return escapeDataviewString(escapeRegex(value));
}

function isDataviewFileLike(value: unknown): value is DataviewFileLike {
	return (
		typeof value === "object" &&
		value !== null &&
		"path" in value &&
		typeof value.path === "string"
	);
}

// biome-ignore lint/complexity/noStaticOnlyClass: <explanation>
export class DataviewIntegration {
	private static getDataviewAPI(app: App): DataviewQueryApi | null {
		const dataview = getAPI(app);
		if (!dataview) {
			log.logMessage("Dataview plugin is not installed or enabled");
			return null;
		}
		return dataview;
	}

	/**
	 * Get all values for a field using Dataview API
	 * @param app The Obsidian app instance
	 * @param fieldName The field name to search for
	 * @returns Set of unique field values
	 */
	static async getFieldValues(app: App, fieldName: string): Promise<Set<string>> {
		const values = new Set<string>();
		const dv = this.getDataviewAPI(app);
		
		if (!dv) {
			return values;
		}

		try {
			// Query for all pages that have this field
			// Properly escape field name to prevent injection
			const escapedFieldName = escapeDataviewString(fieldName);
			const safe = `field("${escapedFieldName}")`;
			const query = `TABLE ${safe} WHERE ${safe}`;
			const result = await dv.query(query);
			
			if (result.successful && result.value.values) {
				// result.value.values is an array of [file, fieldValue] pairs
				for (const row of result.value.values) {
					const fieldValue = row[1]; // Second element is the field value
					
					if (Array.isArray(fieldValue)) {
						// Handle array values
						fieldValue.forEach(v => {
							if (v && typeof v === 'string') {
								values.add(v.trim());
							} else if (isDataviewFileLike(v)) {
								// Handle file objects from Dataview
								values.add(v.path);
							} else if (v && typeof v !== 'object') {
								values.add(String(v).trim());
							}
						});
					} else if (isDataviewFileLike(fieldValue)) {
						// Handle single file object from Dataview
						values.add(fieldValue.path);
					} else if (fieldValue && typeof fieldValue === 'string') {
						// Handle comma-separated values
						if (fieldValue.includes(',')) {
							fieldValue.split(',')
								.map(v => v.trim())
								.filter(v => v.length > 0)
								.forEach(v => values.add(v));
						} else {
							values.add(fieldValue.trim());
						}
					} else if (fieldValue && typeof fieldValue !== 'object') {
						// Handle other non-object values
						values.add(String(fieldValue).trim());
					}
				}
			}
		} catch (error) {
			log.logError(new Error(`Failed to query Dataview for field ${fieldName}: ${error}`));
		}

		return values;
	}

	/**
	 * Get field values with filtering support
	 * @param app The Obsidian app instance
	 * @param fieldName The field name to search for
	 * @param folder Optional folder to filter by
	 * @param tags Optional tags to filter by
	 * @param excludeFolders Optional folders to exclude
	 * @param excludeTags Optional tags to exclude
	 * @returns Set of unique field values
	 */
	static async getFieldValuesWithFilter(
		app: App, 
		fieldName: string, 
		filters: FieldFilter = {},
	): Promise<Set<string>> {
		const values = new Set<string>();
		const dv = this.getDataviewAPI(app);
		
		if (!dv) {
			return values;
		}

		try {
			// Build the WHERE clause
			// Properly escape field name to prevent injection
			const escapedFieldName = escapeDataviewString(fieldName);
			const safe = `field("${escapedFieldName}")`;
			const conditions: string[] = [safe]; // Field must exist

			const includeFolders = (filters.folders?.length
				? filters.folders
				: filters.folder
					? [filters.folder]
					: [])
				.map(folder => folder.replace(/^\/+|\/+$/g, ""))
				.filter(Boolean);
			if (includeFolders.length > 0) {
				const folderConditions = includeFolders.map(folder => {
					const escapedFolder = escapeRegexForDataviewString(folder);
					return `regexmatch("^${escapedFolder}/", file.path)`;
				});
				conditions.push(`(${folderConditions.join(" OR ")})`);
			}
			
			if (filters.tags && filters.tags.length > 0) {
				// Add tag conditions (file must have all specified tags)
				filters.tags.forEach(tag => {
					const tagName = tag.startsWith('#') ? tag : `#${tag}`;
					conditions.push(`contains(file.tags, "${escapeDataviewString(tagName)}")`);
				});
			}
			
			// Add exclusion conditions
			if (filters.excludeFolders && filters.excludeFolders.length > 0) {
				filters.excludeFolders.forEach(excludeFolder => {
					const normalizedFolder = excludeFolder.replace(/^\/+|\/+$/g, '');
					conditions.push(`!regexmatch("^${escapeRegexForDataviewString(normalizedFolder)}/", file.path)`);
				});
			}
			
			if (filters.excludeTags && filters.excludeTags.length > 0) {
				filters.excludeTags.forEach(excludeTag => {
					const tagName = excludeTag.startsWith('#') ? excludeTag : `#${excludeTag}`;
					conditions.push(`!contains(file.tags, "${escapeDataviewString(tagName)}")`);
				});
			}
			
			const whereClause = conditions.join(' AND ');
			const query = `TABLE ${safe} WHERE ${whereClause}`;
			const result = await dv.query(query);
			
			// Dataview's query builder can't express exclude-file, so apply it by
			// dropping excluded files' rows here — keeping Dataview's richer value
			// parsing (comma-splitting, link/file-object handling) instead of
			// bypassing Dataview to the manual collector. Matches the manual
			// filter's semantics: exact file name (with extension) OR full path.
			const excludeFiles = filters.excludeFiles ?? [];
			const isExcludedRowFile = (row: unknown[]): boolean => {
				if (excludeFiles.length === 0) return false;
				const fileCol = row[0] as { path?: unknown } | null;
				const filePath =
					fileCol && typeof fileCol.path === "string" ? fileCol.path : null;
				if (!filePath) return false;
				const baseName = filePath.split("/").pop() ?? filePath;
				return excludeFiles.some((e) => e === filePath || e === baseName);
			};

			if (result.successful && result.value.values) {
				// Process results same as above
				for (const row of result.value.values) {
					if (isExcludedRowFile(row)) continue;
					const fieldValue = row[1];

					if (Array.isArray(fieldValue)) {
						fieldValue.forEach(v => {
							if (v && typeof v === 'string') {
								values.add(v.trim());
							} else if (isDataviewFileLike(v)) {
								// Handle file objects from Dataview
								values.add(v.path);
							} else if (v && typeof v !== 'object') {
								values.add(String(v).trim());
							}
						});
					} else if (isDataviewFileLike(fieldValue)) {
						// Handle single file object from Dataview
						values.add(fieldValue.path);
					} else if (fieldValue && typeof fieldValue === 'string') {
						if (fieldValue.includes(',')) {
							fieldValue.split(',')
								.map(v => v.trim())
								.filter(v => v.length > 0)
								.forEach(v => values.add(v));
						} else {
							values.add(fieldValue.trim());
						}
					} else if (fieldValue && typeof fieldValue !== 'object') {
						values.add(String(fieldValue).trim());
					}
				}
			}
		} catch (error) {
			log.logError(new Error(`Failed to query Dataview for field ${fieldName} with filters: ${error}`));
		}

		return values;
	}

	/**
	 * Check if Dataview is available
	 */
	static isAvailable(app: App): boolean {
		return getAPI(app) !== null;
	}
}
