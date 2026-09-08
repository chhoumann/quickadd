import { describe, expect, it } from "vitest";
import { planPropertyUpdate, resolveCapturePropertyKey, validatePropertyName } from "./captureProperty";
import { parsePropertyCapture } from "../types/choices/ICaptureChoice";

const set = { action: "set", createIfMissing: true } as const;
const add = { action: "addToList", createIfMissing: true } as const;

describe("property capture values", () => {
	it.each(["001", "false", "2026-09-07", "[a, b]", "a,b", "", "a\nb"])("keeps plain text %j as text", (value) => {
		expect(planPropertyUpdate({ frontmatter: { status: "active" }, key: "status", value, config: set, registeredType: "text" })).toBe(value);
	});
	it.each([0, false, [], ["one", "two"]])("preserves a new typed value %j", (value) => {
		expect(planPropertyUpdate({ frontmatter: {}, key: "property", value, config: set, registeredType: null })).toEqual(value);
	});
	it("adds distinct items in order without splitting text or changing existing data", () => {
		const frontmatter = { sources: ["a,b", "old"], status: "active" };
		expect(planPropertyUpdate({ frontmatter, key: "sources", value: ["old", "new", "new"], config: add, registeredType: "multitext" })).toEqual(["a,b", "old", "new"]);
		expect(planPropertyUpdate({ frontmatter, key: "sources", value: "one,two\nthree", config: add, registeredType: null })).toEqual(["a,b", "old", "one,two\nthree"]);
		expect(frontmatter).toEqual({ sources: ["a,b", "old"], status: "active" });
	});
	it("can replace and explicitly clear a list", () => {
		expect(planPropertyUpdate({ frontmatter: { tags: ["old"] }, key: "tags", value: [], config: set, registeredType: "tags" })).toEqual([]);
	});
	it.each(["", []])("keeps an empty addition %j from changing the list", (value) => {
		expect(planPropertyUpdate({ frontmatter: { items: ["old", "old"] }, key: "items", value, config: add, registeredType: null })).toEqual(["old", "old"]);
	});
	it("uses registered types even for missing and null properties", () => {
		for (const frontmatter of [{}, { done: null }]) {
			expect(() => planPropertyUpdate({ frontmatter, key: "done", value: "false", config: set, registeredType: "checkbox" })).toThrow("requires checkbox");
			expect(planPropertyUpdate({ frontmatter, key: "done", value: false, config: set, registeredType: "checkbox" })).toBe(false);
		}
	});
	it("infers an existing type without a registry and rejects mismatches", () => {
		expect(() => planPropertyUpdate({ frontmatter: { count: 3 }, key: "count", value: "0", config: set, registeredType: null })).toThrow("requires number");
		expect(planPropertyUpdate({ frontmatter: { count: 3 }, key: "count", value: 0, config: set, registeredType: null })).toBe(0);
	});
	it("rejects scalar-to-list conversion", () => {
		expect(() => planPropertyUpdate({ frontmatter: { tags: "old" }, key: "tags", value: "new", config: add, registeredType: "tags" })).toThrow("requires a list");
		expect(() => planPropertyUpdate({ frontmatter: { tags: "old" }, key: "tags", value: ["new"], config: set, registeredType: "tags" })).toThrow("correcting the existing property to a list");
	});
	it("sets one literal list item from text and clears a list from empty text", () => {
		expect(planPropertyUpdate({ frontmatter: { sources: ["old"] }, key: "sources", value: "one,two", config: set, registeredType: null })).toEqual(["one,two"]);
		expect(planPropertyUpdate({ frontmatter: { sources: ["old"] }, key: "sources", value: "", config: set, registeredType: null })).toEqual([]);
		expect(planPropertyUpdate({ frontmatter: {}, key: "sources", value: "one,two", config: set, registeredType: "multitext" })).toEqual(["one,two"]);
	});
	it.each([{ nested: true }, ["a", 2], null, undefined, Number.NaN, Infinity])("rejects unsupported captured value %j", (value) => {
		expect(() => planPropertyUpdate({ frontmatter: {}, key: "x", value, config: set, registeredType: null })).toThrow("supports text");
	});
	it.each([{ nested: true }, ["a", 2]])("protects unsupported existing value %j even during Set", (value) => {
		expect(() => planPropertyUpdate({ frontmatter: { x: value }, key: "x", value: "replacement", config: set, registeredType: null })).toThrow("supports text");
	});
	it("distinguishes a missing own property from inherited and null values", () => {
		const config = { ...set, createIfMissing: false };
		expect(() => planPropertyUpdate({ frontmatter: {}, key: "constructor", value: "x", config, registeredType: null })).toThrow("is missing");
		expect(planPropertyUpdate({ frontmatter: { constructor: null }, key: "constructor", value: "x", config, registeredType: null })).toBe("x");
	});
	it("resolves existing property names without case-sensitive duplicate creation", () => {
		expect(resolveCapturePropertyKey({ Status: "active" }, "status")).toBe("Status");
		expect(resolveCapturePropertyKey({ Status: "active", status: "done" }, "status")).toBe("status");
		expect(() => resolveCapturePropertyKey({ Status: "active", STATUS: "done" }, "status")).toThrow("multiple properties");
		expect(planPropertyUpdate({ frontmatter: { Status: "active" }, key: "status", value: "done", config: { ...set, createIfMissing: false }, registeredType: null })).toBe("done");
	});
	it("rejects malformed settings instead of falling back to body capture", () => {
		expect(() => parsePropertyCapture({ property: { kind: "named", format: "status" }, action: "append" })).toThrow("Invalid property");
		expect(() => parsePropertyCapture(null)).toThrow("Invalid property");
	});
	it.each(["", "  ", "a\nb", "__proto__"])("rejects unsafe property name %j", (name) => {
		expect(() => validatePropertyName(name)).toThrow("Property name");
	});
});
