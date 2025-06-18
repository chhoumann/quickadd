import type { App } from "obsidian";
import { getAPI, type DataviewApi } from "obsidian-dataview";

// biome-ignore lint/complexity/noStaticOnlyClass: <explanation>
export class DataviewIntegration {
	private static getDataviewAPI(app: App): DataviewApi | null {
		const dataview = getAPI(app);
		if (!dataview) {
			console.log("Dataview plugin is not installed or enabled");
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
			const query = `TABLE ${fieldName} WHERE ${fieldName}`;
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
							} else if (v && typeof v === 'object' && v.path) {
								// Handle file objects from Dataview
								values.add(v.path);
							} else if (v && typeof v !== 'object') {
								values.add(String(v).trim());
							}
						});
					} else if (fieldValue && typeof fieldValue === 'object' && fieldValue.path) {
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
			console.error(`Failed to query Dataview for field ${fieldName}:`, error);
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
		folder?: string, 
		tags?: string[],
		excludeFolders?: string[],
		excludeTags?: string[]
	): Promise<Set<string>> {
		const values = new Set<string>();
		const dv = this.getDataviewAPI(app);
		
		if (!dv) {
			return values;
		}

		try {
			// Build the WHERE clause
			const conditions: string[] = [fieldName]; // Field must exist
			
			if (folder) {
				// Normalize folder path
				const normalizedFolder = folder.replace(/^\/+|\/+$/g, '');
				conditions.push(`regexmatch("^${normalizedFolder}/", file.path)`);
			}
			
			if (tags && tags.length > 0) {
				// Add tag conditions (file must have all specified tags)
				tags.forEach(tag => {
					const tagName = tag.startsWith('#') ? tag : `#${tag}`;
					conditions.push(`contains(file.tags, "${tagName}")`);
				});
			}
			
			// Add exclusion conditions
			if (excludeFolders && excludeFolders.length > 0) {
				excludeFolders.forEach(excludeFolder => {
					const normalizedFolder = excludeFolder.replace(/^\/+|\/+$/g, '');
					conditions.push(`!regexmatch("^${normalizedFolder}/", file.path)`);
				});
			}
			
			if (excludeTags && excludeTags.length > 0) {
				excludeTags.forEach(excludeTag => {
					const tagName = excludeTag.startsWith('#') ? excludeTag : `#${excludeTag}`;
					conditions.push(`!contains(file.tags, "${tagName}")`);
				});
			}
			
			const whereClause = conditions.join(' AND ');
			const query = `TABLE ${fieldName} WHERE ${whereClause}`;
			const result = await dv.query(query);
			
			if (result.successful && result.value.values) {
				// Process results same as above
				for (const row of result.value.values) {
					const fieldValue = row[1];
					
					if (Array.isArray(fieldValue)) {
						fieldValue.forEach(v => {
							if (v && typeof v === 'string') {
								values.add(v.trim());
							} else if (v && typeof v === 'object' && v.path) {
								// Handle file objects from Dataview
								values.add(v.path);
							} else if (v && typeof v !== 'object') {
								values.add(String(v).trim());
							}
						});
					} else if (fieldValue && typeof fieldValue === 'object' && fieldValue.path) {
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
			console.error(`Failed to query Dataview for field ${fieldName} with filters:`, error);
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