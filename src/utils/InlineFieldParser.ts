import { splitWikilinkAwareList } from "./splitWikilinkAwareList";

export class InlineFieldParser {
	// Regex to match inline fields in the format "fieldname:: value".
	// Captures: fieldname (trimmed by the caller) and value, until end of line.
	//
	// The field name has no separate leading `[ \t]*`: a standalone `[ \t]*`
	// before the lazy `([^:\n\r]+?)` (which also matches spaces/tabs) lets the
	// engine try every split of a long whitespace run against a line with no
	// `::`, which is O(n^2) backtracking (ReDoS) over untrusted note content.
	// Leading indentation is instead absorbed by the capture (the caller trims
	// it) and skipped inside the task-checkbox lookahead, leaving a single
	// line-consuming quantifier so matching stays linear.
	private static readonly INLINE_FIELD_REGEX =
		/(?:^|[\n\r])(?![ \t]*[-*+][ \t]+\[[ xX]\])([^:\n\r]+?)::[ \t]*(.*)$/gmu;

	private static readonly FRONTMATTER_REGEX = /^---\r?\n[\s\S]*?\r?\n---\r?\n/;
	private static readonly INLINE_CODE_SPAN_REGEX = /`[^`]*`/g;

	// A fenced-code-block opening line: optional indentation, a run of >=3
	// backticks, then an info string that itself contains no backtick. Applied
	// per line (no `g` flag, no cross-line `[\s\S]*?`), so it cannot backtrack
	// across the whole note.
	private static readonly FENCE_OPEN_REGEX = /^[ \t]*(`{3,})([^`]*)$/;
	// A closing line: optional indentation, a run of >=3 backticks, then only
	// trailing whitespace. The run length is compared against the opener
	// separately (CommonMark requires the closer to be at least as long).
	private static readonly FENCE_CLOSE_REGEX = /^[ \t]*(`{3,})[ \t]*$/;

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

			// Handle list syntax (comma-separated values), keeping commas inside
			// `[[wikilinks]]` attached to their link instead of splitting them.
			for (const v of splitWikilinkAwareList(fieldValue)) {
				fields.get(fieldName)?.add(v);
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

	/**
	 * Remove fenced code blocks from the content so inline-field-looking lines
	 * inside code samples (e.g. ```dataview``` blocks) are not collected as real
	 * fields. Blocks whose info-string type is allowlisted keep their body.
	 *
	 * Implemented as a single-pass, line-based scanner. The previous regex
	 * (`(`{3,})([^\r\n`]*)\r?\n([\s\S]*?)(?:\r?\n[ \t]*|[ \t]*)\1`) backtracked
	 * catastrophically: on an unclosed fence followed by a long whitespace run
	 * its lazy body and the `[ \t]*` in the closing alternation overlapped, so
	 * `String.replace` over full untrusted note content was O(n^2) and froze the
	 * main thread (~10s on 64KB, growing quadratically). This scanner pushes each
	 * line to the output (or the in-progress fence buffer) exactly once, so
	 * stripping is linear in the note length.
	 *
	 * The parsed field set is preserved for well-formed notes and the existing
	 * tests, and - unlike a look-ahead scanner - for unclosed fences too: an
	 * opener with no matching closer is emitted verbatim, exactly as the old
	 * regex left it (its backreference never matched, so it stripped nothing).
	 * The differences are confined to unusual/malformed fences, where this
	 * follows CommonMark instead of the old regex's quirks:
	 *   - a fence must begin a line (after optional indentation); a backtick run
	 *     mid-line is no longer mistaken for a fence,
	 *   - a closing fence is backticks plus trailing whitespace only and may be
	 *     longer than the opener (the old regex matched only the opener's exact
	 *     backtick count, leaking the extra backticks into the next value).
	 *
	 * Only backtick fences are stripped, preserving prior behaviour; `~~~`
	 * fences were never handled here and are left untouched. This is deliberately
	 * a narrower, autocomplete-only subset than the file-rewriting migration
	 * script (docs/static/scripts/migrateDataviewToFrontmatter.js), which must
	 * also track tildes and blockquoted fences to avoid destroying note content.
	 */
	private static filterFencedCodeBlocks(
		content: string,
		includeCodeBlocks?: string[],
	): string {
		// A fence needs at least three backticks, so a note without any cannot
		// contain one. Skip the line split/join (and its allocation) entirely -
		// this is the common case for vault-wide autocomplete scans.
		if (!content.includes("```")) return content;

		const allowlistedTypes = new Set(
			(includeCodeBlocks ?? [])
				.map((type) => type.trim().toLowerCase())
				.filter((type) => type.length > 0),
		);

		const lines = content.split("\n");
		const out: string[] = [];

		// While inside a fence we buffer its lines (opener first) so an unclosed
		// fence can be flushed verbatim at EOF instead of guessed to be code.
		let inside = false;
		let openLength = 0;
		let openInfo = "";
		let buffer: string[] = [];

		for (const line of lines) {
			if (!inside) {
				const open = this.matchFenceOpen(line);
				if (open) {
					inside = true;
					openLength = open.length;
					openInfo = open.info;
					buffer = [line];
				} else {
					out.push(line);
				}
				continue;
			}

			if (this.matchFenceClose(line, openLength)) {
				// Closed block: drop it, or keep only its body (the buffered
				// lines after the opener) if its type is allowlisted.
				const normalizedType = openInfo
					.trim()
					.split(/\s+/)[0]
					?.toLowerCase();
				const keepBody =
					allowlistedTypes.size > 0 &&
					normalizedType !== undefined &&
					normalizedType.length > 0 &&
					allowlistedTypes.has(normalizedType);
				if (keepBody) {
					for (let b = 1; b < buffer.length; b++) out.push(buffer[b]);
				}
				inside = false;
				buffer = [];
			} else {
				buffer.push(line);
			}
		}

		// Unclosed fence: emit the buffered lines unchanged, matching the old
		// regex (which stripped nothing when its closing backreference never
		// matched).
		if (inside) {
			for (const line of buffer) out.push(line);
		}

		return out.join("\n");
	}

	/** Match a fence opening line, returning its backtick count and info string. */
	private static matchFenceOpen(
		line: string,
	): { length: number; info: string } | null {
		const match = this.FENCE_OPEN_REGEX.exec(this.stripTrailingCarriage(line));
		if (!match) return null;
		return { length: match[1].length, info: match[2] };
	}

	/** Does this line close a fence opened with `minLength` backticks? */
	private static matchFenceClose(line: string, minLength: number): boolean {
		const match = this.FENCE_CLOSE_REGEX.exec(
			this.stripTrailingCarriage(line),
		);
		return match !== null && match[1].length >= minLength;
	}

	/** Drop a single trailing `\r` so CRLF lines are detected like LF lines. */
	private static stripTrailingCarriage(line: string): string {
		return line.endsWith("\r") ? line.slice(0, -1) : line;
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
