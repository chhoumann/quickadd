import type { IndexedFile, SearchContext } from "./FileIndex";
import { normalizeForSearch } from "./utils";

// Configurable search ranking weights
export const SearchWeights = {
	base: {
		basenameExact: -1000,
		aliasExact: -900,
		basenamePrefix: -500,
		aliasPrefix: -500,
		substringBasename: -300,
		fuzzyMatch: 0,
		unresolvedLink: 1000,
	},
	boosts: {
		sameFolder: -0.15,
		recency: -0.10,
		tagOverlap: -0.05,
		tagOverlapMax: -0.20, // Max boost for multiple tag overlaps
	},
	penalties: {
		titleLengthThreshold: 15,
		titleLengthMultiplier: 0.02,
		aliasMinPenalty: 0.05,
		aliasMaxPenalty: 0.60,
		aliasLengthMultiplier: 0.04,
		positionMultiplier: 0.05,
	},
	thresholds: {
		recencyDays: 1, // Files opened within this many days get recency boost
		fuzzyRelaxCount: 5, // Relax fuzzy threshold if fewer than this many results
	}
} as const;

export type SearchWeightsConfig = typeof SearchWeights;

export function calculateFileScore(
	file: IndexedFile, query: string, context: SearchContext, baseScore: number,
	weights: SearchWeightsConfig, currentFileIndexed?: IndexedFile, matchType?: string,
): number {
	let score = baseScore;

	// Same folder boost
	if (context.currentFolder && file.folder === context.currentFolder) {
		score += weights.boosts.sameFolder;
	}

	// Recent files boost - check openedAt directly from file index
	if (file.openedAt) {
		const recency = (Date.now() - file.openedAt) / (1000 * 60 * 60 * 24); // days
		if (recency < weights.thresholds.recencyDays) score += weights.boosts.recency;
	}


	// Tag overlap boost
	if (context.currentFile) {
		if (currentFileIndexed) {
			const commonTags = file.tags.filter(tag => 
				currentFileIndexed.tags.includes(tag));
			if (commonTags.length > 0) {
				score += weights.boosts.tagOverlap * Math.min(commonTags.length, Math.abs(weights.boosts.tagOverlapMax / weights.boosts.tagOverlap));
			}
		}
	}

	// Length penalty - calculate first as it's used by alias penalty
	const queryNormalized = normalizeForSearch(query);
	const aliasIndex = matchType === 'alias' && file.aliases.length > 0
		? file.aliasesNormalized.findIndex(alias => alias.includes(queryNormalized))
		: -1;
	const titleLength = aliasIndex >= 0 ? file.aliases[aliasIndex].length : file.basename.length;

	// Alias penalty - scale based on length to allow good short aliases to compete
	if (matchType === 'alias') {
		// Length-scaled penalty: minimum 0.05 for short aliases, up to +0.60 for very long aliases
		// This ensures basename matches still have an edge even for short aliases
		const lengthPenalty = Math.max(0, (titleLength - weights.penalties.titleLengthThreshold) * weights.penalties.aliasLengthMultiplier);
		const aliasPenalty = Math.min(weights.penalties.aliasMaxPenalty, weights.penalties.aliasMinPenalty + lengthPenalty);
		score += aliasPenalty;
	}
	
	// Additional length penalty for all matches
	if (titleLength > weights.penalties.titleLengthThreshold) {
		score += (titleLength - weights.penalties.titleLengthThreshold) * weights.penalties.titleLengthMultiplier;
	}

	// Position bonus - earlier matches are better
	const textToSearch = aliasIndex >= 0
		? file.aliasesNormalized[aliasIndex] : file.basenameNormalized;

	const pos = textToSearch.indexOf(queryNormalized);
	if (pos >= 0) {
		score += pos * weights.penalties.positionMultiplier; // Later position = higher score = worse ranking
	}

	// Don't flatten negative scores - preserve ranking differences
	return score;
}

