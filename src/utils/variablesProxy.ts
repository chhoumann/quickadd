/**
 * Creates a plain-object style proxy over a Map so scripts can read/write
 * `params.variables.foo` while the underlying source of truth remains the Map.
 */
export function createVariablesProxy(
	store: Map<string, unknown>
): Record<string, unknown> {
	const target = Object.create(null);

	return new Proxy(target, {
		get(_t, prop: string | symbol) {
			if (typeof prop !== "string") return undefined;
			return store.get(prop);
		},
		set(_t, prop: string | symbol, value) {
			if (typeof prop !== "string") return true;
			store.set(prop, value);
			return true;
		},
		deleteProperty(_t, prop: string | symbol) {
			if (typeof prop !== "string") return true;
			store.delete(prop);
			return true;
		},
		has(_t, prop: string | symbol) {
			return typeof prop === "string" && store.has(prop);
		},
		ownKeys() {
			return Array.from(store.keys());
		},
		getOwnPropertyDescriptor(_t, prop: string | symbol) {
			if (typeof prop !== "string" || !store.has(prop)) return undefined;
			return {
				configurable: true,
				enumerable: true,
			};
		},
	});
}
