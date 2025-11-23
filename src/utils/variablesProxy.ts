/**
 * Creates a plain-object style proxy over a Map so scripts can read/write
 * `params.variables.foo` while the underlying source of truth remains the Map.
 * Includes a hasOwnProperty shim for backward compatibility without exposing
 * the full Object prototype chain.
 */
export function createVariablesProxy(
	store: Map<string, unknown>
): Record<string, unknown> {
	const target = {
		hasOwnProperty: (key: string) => store.has(key),
	};

	return new Proxy(target, {
		get(_t, prop: string | symbol) {
			if (prop === "hasOwnProperty") return target.hasOwnProperty;
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
			if (prop === "hasOwnProperty") {
				return {
					value: target.hasOwnProperty,
					writable: false,
					configurable: false,
					enumerable: false,
				};
			}
			if (typeof prop !== "string" || !store.has(prop)) return undefined;
			return {
				value: store.get(prop),
				writable: true,
				configurable: true,
				enumerable: true,
			};
		},
	});
}
