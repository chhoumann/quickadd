export interface FieldFilter {
	folder?: string;
	tags?: string[];
	inline?: boolean;
	defaultValue?: string;
	defaultEmpty?: boolean;
	defaultAlways?: boolean;
	caseSensitive?: boolean;
	excludeFolders?: string[];
	excludeTags?: string[];
	excludeFiles?: string[];
}

/**
 * Parses the field suggestion syntax to extract field name and filters
 * Examples:
 * - "fieldname" -> { fieldName: "fieldname", filters: {} }
 * - "fieldname|folder:daily" -> { fieldName: "fieldname", filters: { folder: "daily" } }
 * - "fieldname|folder:daily|tag:work|tag:project" -> { fieldName: "fieldname", filters: { folder: "daily", tags: ["work", "project"] } }
 */
function parse(input: string): {
	fieldName: string;
	filters: FieldFilter;
} {
	const parts = input.split("|").map((p) => p.trim());
	const fieldName = parts[0];
	const filters: FieldFilter = {};

	for (let i = 1; i < parts.length; i++) {
		const filterPart = parts[i];
		const colonIndex = filterPart.indexOf(":");

		if (colonIndex === -1) {
			continue; // Skip invalid filter format
		}

		const filterType = filterPart.substring(0, colonIndex).trim();
		const filterValue = filterPart.substring(colonIndex + 1).trim();

		switch (filterType) {
			case "folder":
				filters.folder = filterValue;
				break;
			case "tag": {
				if (!filters.tags) {
					filters.tags = [];
				}
				// Remove # prefix if present
				const tagName = filterValue.startsWith("#")
					? filterValue.substring(1)
					: filterValue;
				filters.tags.push(tagName);
				break;
			}
			case "inline":
				filters.inline = filterValue.toLowerCase() === "true";
				break;
			case "default":
				filters.defaultValue = filterValue;
				break;
			case "default-empty":
				filters.defaultEmpty = filterValue.toLowerCase() === "true";
				break;
			case "default-always":
				filters.defaultAlways = filterValue.toLowerCase() === "true";
				break;
			case "case-sensitive":
				filters.caseSensitive = filterValue.toLowerCase() === "true";
				break;
			case "exclude-folder":
				if (!filters.excludeFolders) {
					filters.excludeFolders = [];
				}
				filters.excludeFolders.push(filterValue);
				break;
			case "exclude-tag": {
				if (!filters.excludeTags) {
					filters.excludeTags = [];
				}
				// Remove # prefix if present
				const excludeTagName = filterValue.startsWith("#")
					? filterValue.substring(1)
					: filterValue;
				filters.excludeTags.push(excludeTagName);
				break;
			}
			case "exclude-file":
				if (!filters.excludeFiles) {
					filters.excludeFiles = [];
				}
				filters.excludeFiles.push(filterValue);
				break;
		}
	}

	return { fieldName, filters };
}

export const FieldSuggestionParser = {
	parse,
};
