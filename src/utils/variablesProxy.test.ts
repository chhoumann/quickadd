import { describe, expect, it } from "vitest";
import { createVariablesProxy } from "./variablesProxy";

describe("createVariablesProxy", () => {
	it("reads and writes through to the backing map", () => {
		const backing = new Map<string, unknown>([["a", 1]]);
		const proxy = createVariablesProxy(backing);

		expect(proxy.a).toBe(1);
		proxy.b = 2;
		expect(backing.get("b")).toBe(2);

		delete proxy.a;
		expect(backing.has("a")).toBe(false);
	});

	it("enumerates keys like a plain object", () => {
		const backing = new Map<string, unknown>([
			["foo", "bar"],
			["num", 3],
		]);
		const proxy = createVariablesProxy(backing);

		expect(Object.keys(proxy)).toEqual(["foo", "num"]);
		expect(JSON.stringify(proxy)).toBe('{"foo":"bar","num":3}');
	});

	it("reflects external map mutations immediately", () => {
		const backing = new Map<string, unknown>();
		const proxy = createVariablesProxy(backing);

		backing.set("outside", 42);
		expect(proxy.outside).toBe(42);

		backing.delete("outside");
		expect(proxy.outside).toBeUndefined();
		expect(Object.keys(proxy)).toEqual([]);
	});

	it("ignores symbol property access and does not throw", () => {
		const backing = new Map<string, unknown>();
		const proxy = createVariablesProxy(backing);
		const sym = Symbol("test");

		// @ts-expect-error accessing symbol
		expect(proxy[sym]).toBeUndefined();
		// @ts-expect-error setting symbol
		proxy[sym] = "value";
		expect(backing.size).toBe(0);
	});

	it("works with for...in and Object.assign", () => {
		const backing = new Map<string, unknown>([
			["x", 1],
			["y", 2],
		]);
		const proxy = createVariablesProxy(backing);

		const seen: string[] = [];
		for (const key in proxy) {
			seen.push(key);
		}
		expect(seen).toEqual(["x", "y"]);

		const copy = Object.assign({}, proxy);
		expect(copy).toEqual({ x: 1, y: 2 });
	});

	it("supports hasOwnProperty shim without exposing full prototype", () => {
		const backing = new Map<string, unknown>([["foo", "bar"]]);
		const proxy = createVariablesProxy(backing);

		expect(typeof proxy.hasOwnProperty).toBe("function");
		expect(proxy.hasOwnProperty("foo")).toBe(true);
		expect(proxy.hasOwnProperty("missing")).toBe(false);
		// Prototype helpers are still absent
		// @ts-expect-error toString is intentionally undefined
		expect(proxy.toString).toBeUndefined();
	});
});
