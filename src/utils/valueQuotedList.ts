// Straight and curly double quotes open and close a quoted option, since editors
// (and Obsidian) auto-substitute curly ones. Single quotes are not special: they
// are common in option text (Bob's, 'tis).
const DOUBLE_QUOTE_CHARS = new Set(['"', "“", "”"]);

function isDoubleQuote(ch: string | undefined): boolean {
	return ch !== undefined && DOUBLE_QUOTE_CHARS.has(ch);
}

// Horizontal whitespace only (space, tab, NBSP, other Unicode spaces) — NOT
// line breaks. VALUE tokens never contain newlines (constants.ts VARIABLE_REGEX
// excludes them), but excluding them here keeps the helper safe if reused.
const HORIZONTAL_WS = /[^\S\r\n]/;

/**
 * Splits a comma-separated VALUE option list while honoring double-quoted
 * fields, so a comma inside `"..."` stays literal. CSV-style rules:
 *   - A field is quoted only when it starts with a double quote (after optional
 *     leading whitespace); a quote anywhere else is literal.
 *   - Inside a quoted field, `""` is one literal quote and a comma is literal.
 *   - A closing quote counts only when the next non-space char is a comma or
 *     end of input.
 *
 * Input that is not cleanly quote-balanced falls back to a plain comma split.
 * Returns raw fields with the quotes stripped; callers trim and filter.
 */
export function splitQuotedCommaList(input: string): string[] {
	const fields: string[] = [];
	let buf = "";
	let inQuotes = false;

	for (let i = 0; i < input.length; i++) {
		const ch = input[i];

		if (inQuotes) {
			if (isDoubleQuote(ch)) {
				if (isDoubleQuote(input[i + 1])) {
					// Doubled quote -> one literal straight quote.
					buf += '"';
					i++;
					continue;
				}
				// Candidate close: valid only if followed by ws* then `,`/EOF.
				let j = i + 1;
				while (j < input.length && HORIZONTAL_WS.test(input[j])) j++;
				if (j >= input.length || input[j] === ",") {
					inQuotes = false;
					i = j - 1; // skip the trailing whitespace up to the delimiter
					continue;
				}
				// Quote closed by other text -> not real quoting; keep legacy.
				return input.split(",");
			}
			buf += ch; // commas (and everything else) are literal inside quotes
			continue;
		}

		if (ch === ",") {
			fields.push(buf);
			buf = "";
			continue;
		}
		if (isDoubleQuote(ch) && buf.trim() === "") {
			// Opening quote: drop any leading whitespace already buffered.
			inQuotes = true;
			buf = "";
			continue;
		}
		buf += ch;
	}

	if (inQuotes) return input.split(","); // unterminated quote -> legacy
	fields.push(buf);
	return fields;
}

/**
 * Strip a single surrounding double-quote pair from one value, applying the same
 * `""` -> `"` unescape as {@link splitQuotedCommaList}. Used to unwrap a
 * `|default:"a, b"` on an option-list token so the default matches its
 * now-unquoted option (in both the preflight form and the runtime fallback).
 * Unquoted values pass through unchanged.
 */
export function unwrapQuotedValue(value: string): string {
	const trimmed = value.trim();
	if (!isDoubleQuote(trimmed[0])) return value;
	// Reuse the list grammar so unwrapping matches splitting exactly (strict
	// close, doubled-quote escape). Only a single, fully balanced quoted field is
	// unwrapped; anything that falls back to a literal split is left untouched.
	const fields = splitQuotedCommaList(trimmed);
	if (fields.length === 1 && fields[0] !== trimmed) return fields[0].trim();
	return value;
}
