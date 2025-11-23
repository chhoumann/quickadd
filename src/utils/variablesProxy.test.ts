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
		expect((proxy as Record<string, unknown>).toString).toBeUndefined();
	});

	it("enumerates via Object.entries and Object.values", () => {
		const backing = new Map<string, unknown>([
			["a", 1],
			["b", "two"],
		]);
		const proxy = createVariablesProxy(backing);

		expect(Object.entries(proxy)).toEqual([
			["a", 1],
			["b", "two"],
		]);
		expect(Object.values(proxy)).toEqual([1, "two"]);
	});

	it("handles empty string and numeric string keys", () => {
		const backing = new Map<string, unknown>();
		const proxy = createVariablesProxy(backing);

		proxy[""] = "empty";
		proxy["123"] = 123;

		expect(backing.get("")).toBe("empty");
		expect(backing.get("123")).toBe(123);
		expect(Object.keys(proxy)).toEqual(["", "123"]);
	});

	it("distinguishes setting undefined vs delete", () => {
		const backing = new Map<string, unknown>();
		const proxy = createVariablesProxy(backing);

		proxy.flag = undefined;
		expect(backing.has("flag")).toBe(true);
		expect(backing.get("flag")).toBeUndefined();

		delete proxy.flag;
		expect(backing.has("flag")).toBe(false);
	});

	it("keeps multiple proxies over the same map in sync", () => {
		const backing = new Map<string, unknown>();
		const proxyA = createVariablesProxy(backing);
		const proxyB = createVariablesProxy(backing);

		proxyA.shared = "yes";
		expect(proxyB.shared).toBe("yes");

		backing.set("other", 42);
		expect(proxyA.other).toBe(42);
		expect(proxyB.other).toBe(42);

		delete proxyB.shared;
		expect(backing.has("shared")).toBe(false);
	});
});
