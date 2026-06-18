export function normalizeTag(tag: unknown): string {
	if (tag === null || tag === undefined) return "";
	if (
		typeof tag !== "string" &&
		typeof tag !== "number" &&
		typeof tag !== "boolean"
	) {
		return "";
	}

	const trimmed = String(tag).trim();
	return trimmed.startsWith("#") ? trimmed.substring(1).trim() : trimmed;
}

export function normalizeFrontmatterTagValues(value: unknown): string[] {
	if (value === null || value === undefined) return [];

	const values = Array.isArray(value)
		? value
		: typeof value === "string"
			? value.split(/,|\s+/)
			: [value];

	return values.map(normalizeTag).filter(Boolean);
}
