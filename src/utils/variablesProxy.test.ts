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
});
