import { describe, expect, it, afterEach } from "vitest";
import { deepClone } from "./deepClone";

describe("deepClone", () => {
	const originalStructuredClone = (globalThis as any).structuredClone;

	afterEach(() => {
		(globalThis as any).structuredClone = originalStructuredClone;
	});

	it("deep clones plain objects when structuredClone is missing", () => {
		(globalThis as any).structuredClone = undefined;

		const value = { a: 1, b: { c: 2 }, d: [1, { e: 3 }] };
		const cloned = deepClone(value);

		expect(cloned).toEqual(value);
		expect(cloned).not.toBe(value);
		expect(cloned.b).not.toBe(value.b);
		expect(cloned.d).not.toBe(value.d);
		expect(cloned.d[1]).not.toBe(value.d[1]);
	});

	it("handles circular references in the fallback clone", () => {
		(globalThis as any).structuredClone = undefined;

		const value: { self?: unknown } = {};
		value.self = value;

		const cloned = deepClone(value) as typeof value;
		expect(cloned).not.toBe(value);
		expect(cloned.self).toBe(cloned);
	});

	it("falls back if structuredClone throws", () => {
		(globalThis as any).structuredClone = () => {
			throw new Error("boom");
		};

		const value = { a: 1, b: { c: 2 } };
		const cloned = deepClone(value);

		expect(cloned).toEqual(value);
		expect(cloned).not.toBe(value);
		expect(cloned.b).not.toBe(value.b);
	});

	it("clones class instances without mutating the original", () => {
		(globalThis as any).structuredClone = undefined;

		class Example {
			public nested: { value: number };

			constructor(value: number) {
				this.nested = { value };
			}
		}

		const instance = new Example(123);
		const cloned = deepClone(instance);

		expect(cloned).toBeInstanceOf(Example);
		expect(cloned).not.toBe(instance);
		expect(cloned.nested).toEqual(instance.nested);
		expect(cloned.nested).not.toBe(instance.nested);
	});
});
