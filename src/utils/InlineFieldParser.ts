export namespace InlineFieldParser {
	// Regex to match inline fields in the format "fieldname:: value"
	// Captures: fieldname and value (until end of line or next field)
	const INLINE_FIELD_REGEX =
		/(?:^|[\n\r])[ \t]*(?![-*+][ \t]+\[[ xX]\])([^:\n\r]+?)::[ \t]*(.*)$/gmu;

	/**
	 * Extracts inline fields from the content of a file
	 * @param content The file content to parse
	 * @returns Map of field names to their values
	 */
	export function parseInlineFields(content: string): Map<string, Set<string>> {
		const fields = new Map<string, Set<string>>();

		// Remove code blocks and frontmatter to avoid false positives
		const cleanedContent = removeCodeBlocksAndFrontmatter(content);

		let match: RegExpExecArray | null = INLINE_FIELD_REGEX.exec(cleanedContent);
		while (match !== null) {
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
				values.forEach((v) => {
					fields.get(fieldName)?.add(v);
				});
			} else {
				fields.get(fieldName)?.add(fieldValue);
			}
			match = INLINE_FIELD_REGEX.exec(cleanedContent);
		}

		// Reset regex lastIndex for next use
		INLINE_FIELD_REGEX.lastIndex = 0;

		return fields;
	}

	function removeCodeBlocksAndFrontmatter(content: string): string {
		// Remove frontmatter (handle both Unix and Windows line endings)
		const frontmatterRegex = /^---\r?\n[\s\S]*?\r?\n---\r?\n/;
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
	export function getFieldValues(
		content: string,
		fieldName: string
	): Set<string> {
		const fields = parseInlineFields(content);
		return fields.get(fieldName) || new Set();
	}
}
