/**
 * A `$state`-backed props object for `mountComponent`. The mounted component
 * re-renders when a property is set from outside, and a bindable prop the
 * component writes lands back on this object, where the host reads it.
 */
export function reactiveProps<T extends object>(initial: T): T {
	// $state must initialize a variable declaration (not be returned directly).
	const props = $state(initial);
	return props;
}
