/**
 * Split a comma-separated inline-field value into individual values while
 * treating commas inside `[[wikilinks]]` as literal content rather than list
 * separators.
 *
 * Dataview-style inline fields use commas to separate list items
 * (`tags:: a, b, c`), but a single wikilink target can itself contain a comma
 * (`Related:: [[Note, with comma]]`). A naive `value.split(",")` shreds such a
 * wikilink into `"[[Note"` and `"with comma]]"`, which then surfaces as garbled
 * field-value autocomplete suggestions. This helper walks the string once and
 * only splits on commas that sit outside a `[[ ... ]]` span.
 *
 * Values are trimmed and empty fragments are dropped, matching the previous
 * `split(",").map(trim).filter(length)` behaviour for non-wikilink input so the
 * change is byte-identical for plain comma lists.
 *
 * Known limitation: commas inside Markdown link destinations (`[text](a,b)`) are
 * still treated as separators. Inline fields rarely carry raw Markdown links and
 * the only consumer is read-only autocomplete, so wikilink awareness covers the
 * real cases without turning this into a full Markdown parser.
 */
export function splitWikilinkAwareList(value: string): string[] {
	// Fast path: no comma means there is nothing to split.
	if (!value.includes(",")) {
		const trimmed = value.trim();
		return trimmed ? [trimmed] : [];
	}

	const values: string[] = [];
	let current = "";
	let insideWikilink = false;

	for (let i = 0; i < value.length; i++) {
		const char = value[i];
		const nextChar = value[i + 1];

		// Enter a wikilink span on `[[` so its inner commas are preserved.
		if (char === "[" && nextChar === "[") {
			insideWikilink = true;
			current += char;
			continue;
		}

		// Leave the span on `]]`.
		if (char === "]" && nextChar === "]") {
			insideWikilink = false;
			current += char;
			continue;
		}

		// Only commas outside a wikilink span separate list items.
		if (char === "," && !insideWikilink) {
			const trimmed = current.trim();
			if (trimmed) values.push(trimmed);
			current = "";
			continue;
		}

		current += char;
	}

	const trimmed = current.trim();
	if (trimmed) values.push(trimmed);

	return values;
}
