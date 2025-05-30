export class InlineFieldParser {
	// Regex to match inline fields in the format "fieldname:: value"
	// Captures: fieldname and value (until end of line or next field)
	private static readonly INLINE_FIELD_REGEX =
		/(?:^|[\n\r])[ \t]*(?![-*+][ \t]+\[[ xX]\])([a-zA-Z0-9_\- ]+)::[ \t]*(.*)$/gm;

	/**
	 * Extracts inline fields from the content of a file
	 * @param content The file content to parse
	 * @returns Map of field names to their values
	 */
	static parseInlineFields(content: string): Map<string, Set<string>> {
		const fields = new Map<string, Set<string>>();

		// Remove code blocks and frontmatter to avoid false positives
		const cleanedContent = this.removeCodeBlocksAndFrontmatter(content);

		let match;
		while (
			(match = InlineFieldParser.INLINE_FIELD_REGEX.exec(
				cleanedContent,
			)) !== null
		) {
			const fieldName = match[1].trim();
			const fieldValue = match[2].trim();

			// Skip empty values
			if (!fieldValue) continue;

			if (!fields.has(fieldName)) {
				fields.set(fieldName, new Set());
			}

			// Handle list syntax (comma-separated values)
			if (fieldValue.includes(",")) {
				const values = fieldValue
					.split(",")
					.map((v) => v.trim())
					.filter((v) => v.length > 0);
				values.forEach((v) => fields.get(fieldName)?.add(v));
			} else {
				fields.get(fieldName)?.add(fieldValue);
			}
		}

		// Reset regex lastIndex for next use
		InlineFieldParser.INLINE_FIELD_REGEX.lastIndex = 0;

		return fields;
	}

	private static removeCodeBlocksAndFrontmatter(content: string): string {
		// Remove frontmatter
		const frontmatterRegex = /^---\n[\s\S]*?\n---\n/;
		content = content.replace(frontmatterRegex, "");

		// Remove code blocks (both ``` and `)
		const codeBlockRegex = /```[\s\S]*?```|`[^`]*`/g;
		content = content.replace(codeBlockRegex, "");

		return content;
	}

	/**
	 * Extracts a specific inline field from content
	 * @param content The file content to parse
	 * @param fieldName The field name to look for
	 * @returns Set of values for the field, or empty set if not found
	 */
	static getFieldValues(content: string, fieldName: string): Set<string> {
		const fields = this.parseInlineFields(content);
		return fields.get(fieldName) || new Set();
	}
}