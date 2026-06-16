/** Wrap a value as an Obsidian wikilink for |multi:linklist, idempotently. */
export function toWikiLink(value: string): string {
	const trimmed = value.trim();
	if (!trimmed) return trimmed;
	return /^\[\[.*\]\]$/.test(trimmed) ? trimmed : `[[${trimmed}]]`;
}
