export function deepClone<T>(value: T): T {
	const structuredCloneFn = (globalThis as any).structuredClone as
		| ((value: unknown) => unknown)
		| undefined;

	if (typeof structuredCloneFn === "function") {
		try {
			return structuredCloneFn(value) as T;
		} catch {
			// Fall back to a JS implementation below.
		}
	}

	return deepCloneFallback(value, new Map()) as T;
}

function deepCloneFallback(value: unknown, seen: Map<unknown, unknown>): unknown {
	if (value === null || typeof value !== "object") {
		return value;
	}

	if (seen.has(value)) {
		return seen.get(value);
	}

	if (value instanceof Date) {
		const cloned = new Date(value.getTime());
		seen.set(value, cloned);
		return cloned;
	}

	if (Array.isArray(value)) {
		const cloned: unknown[] = [];
		seen.set(value, cloned);
		for (const item of value) {
			cloned.push(deepCloneFallback(item, seen));
		}
		return cloned;
	}

	if (value instanceof Map) {
		const cloned = new Map();
		seen.set(value, cloned);
		for (const [key, nestedValue] of value.entries()) {
			cloned.set(
				deepCloneFallback(key, seen),
				deepCloneFallback(nestedValue, seen),
			);
		}
		return cloned;
	}

	if (value instanceof Set) {
		const cloned = new Set();
		seen.set(value, cloned);
		for (const item of value.values()) {
			cloned.add(deepCloneFallback(item, seen));
		}
		return cloned;
	}

	if (value instanceof RegExp) {
		const cloned = new RegExp(value.source, value.flags);
		cloned.lastIndex = value.lastIndex;
		seen.set(value, cloned);
		return cloned;
	}

	if (value instanceof ArrayBuffer) {
		const cloned = value.slice(0);
		seen.set(value, cloned);
		return cloned;
	}

	if (ArrayBuffer.isView(value)) {
		if (value instanceof DataView) {
			const cloned = new DataView(
				deepCloneFallback(value.buffer, seen) as ArrayBuffer,
				value.byteOffset,
				value.byteLength,
			);
			seen.set(value, cloned);
			return cloned;
		}

		const typedArray = value as unknown as {
			constructor: new (
				buffer: ArrayBuffer,
				byteOffset: number,
				length: number,
			) => unknown;
			buffer: ArrayBuffer;
			byteOffset: number;
			length: number;
		};
		const clonedBuffer = deepCloneFallback(typedArray.buffer, seen) as ArrayBuffer;
		const cloned = new typedArray.constructor(
			clonedBuffer,
			typedArray.byteOffset,
			typedArray.length,
		);
		seen.set(value, cloned);
		return cloned;
	}

	const prototype = Object.getPrototypeOf(value);
	const cloned: Record<string, unknown> = Object.create(prototype);
	seen.set(value, cloned);
	for (const [key, nestedValue] of Object.entries(value)) {
		Object.defineProperty(cloned, key, {
			value: deepCloneFallback(nestedValue, seen),
			writable: true,
			enumerable: true,
			configurable: true,
		});
	}
	return cloned;
}
