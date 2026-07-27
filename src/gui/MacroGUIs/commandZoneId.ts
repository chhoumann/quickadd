let counter = 0;

/**
 * A process-unique suffix for a CommandList's svelte-dnd-action zone type.
 *
 * svelte-dnd-action groups drop zones by `type` and hit-tests every zone in the
 * group geometrically, so two command lists sharing a type are mutually valid
 * drop targets even when one is a modal stacked on top of the other. QuickAdd
 * offers no cross-list command drag - a command has no "move into" gesture the
 * way a folder does - so every list gets its own group of exactly one (#1613).
 *
 * A module-level counter rather than a uuid: it only has to be unique among the
 * zones alive in this window, and a stable, readable `command:3` is easier to
 * recognise in a DOM dump than a uuid.
 */
export function nextCommandZoneId(): number {
	counter += 1;
	return counter;
}
