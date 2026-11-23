import type IChoice from "../../types/choices/IChoice";
import {
	normalizeChoiceList,
	type NormalizedChoiceList,
} from "../../utils/choiceUtils";

const seededByRaw = new WeakMap<object, NormalizedChoiceList>();

/**
 * `normalizeChoiceList`, memoized on the identity of the raw array. The repair
 * is not persisted until the next edit, and re-normalizing would mint different
 * uuids for the same choice: a by-id write awaiting a builder would then match
 * nothing and drop the user's edits, and command registration would leave a dead
 * palette entry per settings open. Module-level, because the settings tab
 * re-mounts ChoiceView on every open. Keying on the previous id would not work:
 * every id-less entry shares `undefined`.
 */
export function seedChoiceTree(raw: IChoice[]): NormalizedChoiceList {
	const cached = seededByRaw.get(raw);
	if (cached) return cached;

	const result = normalizeChoiceList(raw);
	seededByRaw.set(raw, result);
	return result;
}

/**
 * Whether this exact array has already been seeded. Lets the caller run its
 * one-time side effects (command registration) only on a cache MISS, without
 * having to model that itself.
 */
export function hasSeeded(raw: IChoice[]): boolean {
	return seededByRaw.has(raw);
}
