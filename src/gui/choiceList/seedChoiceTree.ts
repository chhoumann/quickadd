import type IChoice from "../../types/choices/IChoice";
import {
	normalizeChoiceList,
	type NormalizedChoiceList,
} from "../../utils/choiceUtils";

const seededByRaw = new WeakMap<object, NormalizedChoiceList>();

/**
 * `normalizeChoiceList`, memoized on the identity of the raw array it was given.
 *
 * The repair is not persisted - it reaches disk with the user's first ordinary
 * edit - so the same unrepaired array is normalized again every time anything
 * re-reads it, and each of those would mint DIFFERENT uuids for the same choice.
 * Two things go wrong when that happens, and neither is cosmetic:
 *
 *   - ChoiceView's subscription fires on EVERY settingsStore write, including
 *     ones nothing in the view caused (the AI provider auto-sync lands one a few
 *     seconds after launch). Every by-id write in the view resolves its target
 *     BEFORE an await - handleConfigureChoice captures the choice, awaits the
 *     builder, then matches on `oldChoice.id === newChoice.id` - so a re-mint
 *     inside that window turns the match into a no-op and silently discards the
 *     user's edits.
 *   - The settings tab DESTROYS and re-mounts ChoiceView every time it is
 *     opened. A memo living in the component would miss that, so a repaired
 *     `command: true` choice would be registered under a fresh id on every
 *     open, leaving one dead palette entry per open.
 *
 * Hence a module-level WeakMap rather than component state: the cache outlives
 * the component, and is keyed on the array object so an unrelated `setState`
 * (zustand merges partials, leaving `state.choices` reference-identical) hits it
 * while a genuine tree change misses it. Entries die with the array.
 *
 * Keying on the choice's own previous id would NOT work: `undefined` collides
 * across every id-less entry, so two siblings would be handed the same uuid -
 * `each_key_duplicate` again (#1451).
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
