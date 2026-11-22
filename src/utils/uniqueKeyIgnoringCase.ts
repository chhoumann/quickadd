/**
 * `key` when it is one of `keys`, else the one key that matches it ignoring
 * case. Two case-insensitive matches are ambiguous and yield `undefined`.
 */
export function uniqueKeyIgnoringCase(keys: Iterable<string>, key: string): string | undefined {
	const lower = key.toLowerCase();
	const matches = [...keys].filter((candidate) => candidate.toLowerCase() === lower);
	if (matches.includes(key)) return key;
	return matches.length === 1 ? matches[0] : undefined;
}
