import type { CachedMetadata } from "obsidian";

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

/**
 * Every tag a note carries, without `#`: its frontmatter `tags`/`tag` (any key
 * case, as Obsidian reads them) and its inline tags.
 */
export function noteTags(metadata: CachedMetadata | null | undefined): string[] {
	if (!metadata) return [];
	const frontmatterTags = Object.entries(metadata.frontmatter ?? {})
		.filter(([key]) => /^tags?$/i.test(key))
		.flatMap(([, value]) => normalizeFrontmatterTagValues(value));
	const inlineTags = Array.isArray(metadata.tags)
		? metadata.tags.map((entry) => normalizeTag(entry.tag))
		: [];
	return [...frontmatterTags, ...inlineTags].filter(Boolean);
}
