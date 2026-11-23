/**
 * Add the suggestion values a frontmatter property holds to `values`: a scalar,
 * or each scalar item of a list, trimmed, with blanks dropped. Missing values
 * and objects are skipped, since `String()` would turn them into "undefined",
 * "null" or "[object Object]".
 */
export function addPropertyValues(values: Set<string>, property: unknown): void {
	for (const item of Array.isArray(property) ? property : [property]) {
		if (item === undefined || item === null || typeof item === "object") continue;
		const value = String(item).trim();
		if (value) values.add(value);
	}
}
