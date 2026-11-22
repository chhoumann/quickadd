/**
 * `key` when it is one of `keys`, else the one key that matches it ignoring
 * case. Two such matches are ambiguous, as they are when the run resolves a
 * named {{VALUE}}, so they give none.
 */
export function uniqueKeyIgnoringCase(keys: Iterable<string>, key: string): string | undefined {
	const lower = key.toLowerCase();
	const matches = [...keys].filter((candidate) => candidate.toLowerCase() === lower);
	if (matches.includes(key)) return key;
	return matches.length === 1 ? matches[0] : undefined;
}
