/**
 * "Did you mean" for a closed vocabulary of option keys.
 *
 * Written for the `{{FIELD:...|key:value}}` filter list (issue #1564), where the
 * alternative - printing all thirteen keys and letting the reader find the one
 * they meant - produced a 256-character warning that is unreadable as a Notice
 * and needs a three-line clamp inline under a settings field.
 *
 * Three rules, in order, because they catch different mistakes:
 *
 * 1. ONE EDIT AWAY (Damerau, so an adjacent transposition costs 1). The
 *    strongest signal there is, and it goes first: `inlne` shares a prefix with
 *    both `inline` and `inline-code-blocks`, but it is one edit from exactly one
 *    of them. Also `fodler` -> `folder`, `mutli` -> `multi`, `tags` -> `tag`,
 *    `excludetag` -> `exclude-tag`.
 * 2. SHARED PREFIX. Covers "I remembered the family, not the key":
 *    `exclude` -> the three `exclude-*`, `case` -> `case-sensitive`,
 *    `inline-code` -> `inline-code-blocks`. Also covers a half-typed key, which
 *    is most of what a live preview sees.
 * 3. TWO EDITS, long keys only. A second slip is plausible in
 *    `inline-code-blocks`; in a six-letter key it means a different word. That
 *    is what keeps `filter` from being answered with `folder` (distance 2),
 *    which is the sort of confidently-wrong suggestion that is worse than none.
 */

/** Beyond this the input is not a mistyped key, and the matrix is not worth building. */
const MAX_COMPARABLE_LENGTH = 64;

function commonPrefixLength(a: string, b: string): number {
	const max = Math.min(a.length, b.length);
	let i = 0;
	while (i < max && a[i] === b[i]) i++;
	return i;
}

/**
 * Optimal string alignment distance: Levenshtein plus adjacent transposition.
 * Bounded by `max` so a long input exits before filling the matrix - every
 * caller here only cares whether the distance is small.
 */
export function damerauLevenshtein(a: string, b: string, max: number): number {
	if (a === b) return 0;
	if (Math.abs(a.length - b.length) > max) return max + 1;
	if (a.length > MAX_COMPARABLE_LENGTH || b.length > MAX_COMPARABLE_LENGTH) {
		return max + 1;
	}

	let twoRowsBack: number[] = [];
	let previous: number[] = Array.from({ length: b.length + 1 }, (_, i) => i);
	let current: number[] = [];

	for (let i = 1; i <= a.length; i++) {
		current = new Array<number>(b.length + 1);
		current[0] = i;
		let rowMin = current[0];
		for (let j = 1; j <= b.length; j++) {
			const cost = a[i - 1] === b[j - 1] ? 0 : 1;
			let value = Math.min(
				previous[j] + 1, // deletion
				current[j - 1] + 1, // insertion
				previous[j - 1] + cost, // substitution
			);
			if (
				i > 1 &&
				j > 1 &&
				a[i - 1] === b[j - 2] &&
				a[i - 2] === b[j - 1]
			) {
				value = Math.min(value, twoRowsBack[j - 2] + 1); // transposition
			}
			current[j] = value;
			if (value < rowMin) rowMin = value;
		}
		// Every remaining row can only add to the minimum, so once a whole row is
		// past the budget the answer is "further than max".
		if (rowMin > max) return max + 1;
		twoRowsBack = previous;
		previous = current;
	}

	return previous[b.length];
}

/**
 * The candidates worth showing for an unrecognised key, best first, or an empty
 * list when nothing is close enough to name.
 *
 * `limit` caps the list because the point is to be shorter than the vocabulary:
 * suggesting five of thirteen keys is just the dump with extra words.
 */
export function suggestSimilarKeys(
	typed: string,
	candidates: readonly string[],
	limit = 3,
): string[] {
	const needle = typed.trim().toLowerCase();
	if (!needle) return [];

	// Ties keep the vocabulary's own order - the one the fallback message and the
	// docs list them in - rather than an arbitrary alphabetical or length order.
	const pool = candidates
		.map((candidate, index) => ({ candidate, index }))
		.filter((entry) => entry.candidate !== needle);

	const near = pool
		.map((entry) => ({
			...entry,
			distance: damerauLevenshtein(needle, entry.candidate, 2),
		}))
		.filter((entry) => entry.distance <= 1)
		.sort((a, b) => a.distance - b.distance || a.index - b.index);
	if (near.length > 0) {
		return near.slice(0, limit).map((entry) => entry.candidate);
	}

	if (needle.length >= 2) {
		const byPrefix = pool
			.map((entry) => ({
				...entry,
				shared: commonPrefixLength(needle, entry.candidate),
			}))
			.filter((entry) => entry.shared >= 2)
			.sort((a, b) => b.shared - a.shared || a.index - b.index);
		if (byPrefix.length > 0) {
			return byPrefix.slice(0, limit).map((entry) => entry.candidate);
		}
	}

	const byDistance = pool
		.map((entry) => ({
			...entry,
			distance: damerauLevenshtein(needle, entry.candidate, 2),
		}))
		// A longer key has room for a second slip; a short one does not.
		.filter((entry) => entry.distance <= 2 && entry.candidate.length >= 10)
		.sort((a, b) => a.distance - b.distance || a.index - b.index);

	return byDistance.slice(0, limit).map((entry) => entry.candidate);
}
