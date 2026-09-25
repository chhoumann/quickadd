import { prepareFuzzySearch, type SearchMatches } from "obsidian";

export type RankedMatch<T> = { item: T; matches: SearchMatches };

/**
 * Rank items for a query the way Obsidian's quick switcher does, with its own
 * fuzzy scorer: an exact match first, then options that start with the query,
 * then a word inside the option starting with it, then the query anywhere in
 * the option, and gapped (fuzzy) matches last; within a tier shorter options
 * score higher. Equal scores keep list order.
 *
 * The scorer is case-insensitive. With `caseSensitive`, an option must contain
 * the typed text in the same case (no fuzzy widening), and is still ranked by
 * the scorer.
 */
export function rankMatches<T>(
	query: string,
	items: T[],
	text: (item: T) => string,
	options: { limit: number; caseSensitive?: boolean },
): RankedMatch<T>[] {
	const trimmed = query.trim();
	if (!trimmed) {
		return items.slice(0, options.limit).map((item) => ({ item, matches: [] }));
	}

	const search = prepareFuzzySearch(trimmed);
	const ranked: Array<RankedMatch<T> & { score: number }> = [];
	for (const item of items) {
		const label = text(item);
		const result = search(label);
		if (!result) continue;
		let matches = result.matches;
		if (options.caseSensitive) {
			const at = label.indexOf(trimmed);
			if (at < 0) continue;
			matches = [[at, at + trimmed.length]];
		}
		ranked.push({ item, matches, score: result.score });
	}

	return ranked
		.sort((a, b) => b.score - a.score)
		.slice(0, options.limit)
		.map(({ item, matches }) => ({ item, matches }));
}
