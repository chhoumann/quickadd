export class InlineFieldParser {
	// Regex to match inline fields in the format "fieldname:: value"
	// Captures: fieldname and value (until end of line or next field)
	private static readonly INLINE_FIELD_REGEX =
		/(?:^|[\n\r])[ \t]*(?![-*+][ \t]+\[[ xX]\])([^:\n\r]+?)::[ \t]*(.*)$/gmu;

	private static readonly FRONTMATTER_REGEX = /^---\r?\n[\s\S]*?\r?\n---\r?\n/;
	private static readonly FENCED_CODE_BLOCK_REGEX =
		/(`{3,})([^\r\n`]*)\r?\n([\s\S]*?)\r?\n\1/g;
	private static readonly INLINE_CODE_SPAN_REGEX = /`[^`]*`/g;

	/**
	 * Extracts inline fields from the content of a file
	 * @param content The file content to parse
	 * @returns Map of field names to their values
	 */
	static parseInlineFields(
		content: string,
		options?: {
			includeCodeBlocks?: string[];
		},
	): Map<string, Set<string>> {
		const fields = new Map<string, Set<string>>();

		// Remove frontmatter and code spans, and include only explicitly allowlisted fences.
		const cleanedContent = this.removeCodeBlocksAndFrontmatter(content, options);

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

	private static removeCodeBlocksAndFrontmatter(
		content: string,
		options?: {
			includeCodeBlocks?: string[];
		},
	): string {
		content = content.replace(this.FRONTMATTER_REGEX, "");
		content = this.filterFencedCodeBlocks(content, options?.includeCodeBlocks);
		return content.replace(this.INLINE_CODE_SPAN_REGEX, "");
	}

	private static filterFencedCodeBlocks(
		content: string,
		includeCodeBlocks?: string[],
	): string {
		const allowlistedTypes = new Set(
			(includeCodeBlocks ?? [])
				.map((type) => type.trim().toLowerCase())
				.filter((type) => type.length > 0),
		);

		return content.replace(
			this.FENCED_CODE_BLOCK_REGEX,
			(_fullMatch, _fence, infoString, body: string) => {
				const normalizedType = String(infoString)
					.trim()
					.split(/\s+/)[0]
					?.toLowerCase();
				if (
					allowlistedTypes.size > 0 &&
					normalizedType &&
					allowlistedTypes.has(normalizedType)
				) {
					return body;
				}
				return "";
			},
		);
	}

	/**
	 * Extracts a specific inline field from content
	 * @param content The file content to parse
	 * @param fieldName The field name to look for
	 * @returns Set of values for the field, or empty set if not found
	 */
	static getFieldValues(
		content: string,
		fieldName: string,
		options?: {
			includeCodeBlocks?: string[];
		},
	): Set<string> {
		const fields = this.parseInlineFields(content, options);
		return fields.get(fieldName) || new Set();
	}
}
