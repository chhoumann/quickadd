import { prepareFuzzySearch, type SearchMatches, type SearchResult } from "obsidian";

type RankedMatch<T> = { item: T; matches: SearchMatches; alias?: string };

/**
 * Matches `text` and each of `aliases` (a note's other names), keeping whichever
 * scores best; the text wins a tie. `alias` says which alias matched.
 */
export function matchWithAliases(
	search: (text: string) => SearchResult | null,
	text: string,
	aliases: readonly string[] = [],
): { result: SearchResult; alias?: string } | null {
	let result = search(text);
	let alias: string | undefined;
	for (const name of aliases) {
		const aliasResult = search(name);
		if (aliasResult && (!result || aliasResult.score > result.score)) {
			result = aliasResult;
			alias = name;
		}
	}
	if (!result) return null;
	return alias === undefined ? { result } : { result, alias };
}

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
 *
 * `aliases` gives an item other names (a note's aliases); see matchWithAliases.
 * Not combined with `caseSensitive`.
 */
export function rankMatches<T>(
	query: string,
	items: T[],
	text: (item: T) => string,
	options: {
		limit: number;
		caseSensitive?: boolean;
		aliases?: (item: T) => readonly string[] | undefined;
	},
): RankedMatch<T>[] {
	const trimmed = query.trim();
	if (!trimmed) {
		return items.slice(0, options.limit).map((item) => ({ item, matches: [] }));
	}

	const search = prepareFuzzySearch(trimmed);
	const ranked: Array<RankedMatch<T> & { score: number }> = [];
	for (const item of items) {
		const label = text(item);
		const found = matchWithAliases(search, label, options.aliases?.(item));
		if (!found) continue;
		const { result, alias } = found;
		let matches = result.matches;
		if (options.caseSensitive) {
			const at = label.indexOf(trimmed);
			if (at < 0) continue;
			matches = [[at, at + trimmed.length]];
		}
		ranked.push({ item, matches, score: result.score, ...(alias !== undefined ? { alias } : {}) });
	}

	return ranked
		.sort((a, b) => b.score - a.score)
		.slice(0, options.limit)
		.map(({ score: _score, ...match }) => match);
}
