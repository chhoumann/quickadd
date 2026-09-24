import { describe, expect, it } from "vitest";
import {
	captureListItems,
	capturesListItems,
	formatContainsPropertyToken,
	isEmptyCaptureListValue,
	planPropertyUpdate,
	resolveCapturePropertyKey,
	restorePropertyCaptureSeeds,
	seedPropertyCaptureVariables,
	snapshotPropertyCaptureSeeds,
	stringifyPropertyTokenValue,
	validatePropertyName,
} from "./captureProperty";
import { parsePropertyCapture } from "../types/choices/ICaptureChoice";

const set = { action: "set", createIfMissing: true } as const;
const add = { action: "addToList", createIfMissing: true } as const;

describe("captures list items", () => {
	it.each([
		["addToList", "status", null, "text", true],
		["set", "topics", "multitext", undefined, true],
		["set", "Tags", null, undefined, true],
		["set", "topics", null, ["a"], true],
		["set", "topics", null, "a", false],
		["set", "topics", null, undefined, false],
		["set", "topics", "text", ["a"], false],
	] as const)("%s into %s (type %s, current %j) is %s", (action, key, registeredType, existing, expected) => {
		expect(capturesListItems({ key, action, registeredType, existing })).toBe(expected);
	});
});

describe("capture list items", () => {
	it.each([
		["work", ["work"]],
		["Smith, John", ["Smith, John"]],
		["[a, b]", ["[a, b]"]],
		["  work  ", ["work"]],
		["", []],
		[" \n \r\n", []],
		["work\npersonal", ["work", "personal"]],
		["Smith, John\nDoe, Jane", ["Smith, John", "Doe, Jane"]],
		["work\r\n\r\n personal \r\n", ["work", "personal"]],
		["\nwork\npersonal", ["work", "personal"]],
		["- work\n- personal", ["- work", "- personal"]],
		["[[Smith, John|John]]\n[[Doe]]", ["[[Smith, John|John]]", "[[Doe]]"]],
	])("turns %j into the items %j", (value, items) => {
		expect(captureListItems(value)).toEqual(items);
	});
	it.each([
		["", true], [" \n\n", true], [[], true],
		["work", false], ["\nwork", false], [["a"], false], [[""], false], [0, false], [false, false],
	])("treats %j as an empty list addition: %j", (value, empty) => {
		expect(isEmptyCaptureListValue(value)).toBe(empty);
	});
});

describe("lines are list items", () => {
	it("adds each non-blank line as its own item while commas stay inside a line", () => {
		const frontmatter = { tags: ["old"] };
		expect(planPropertyUpdate({ frontmatter, key: "tags", value: "work\nSmith, John\n\nold\n", config: add, registeredType: null }))
			.toEqual(["old", "work", "Smith, John"]);
		expect(planPropertyUpdate({ frontmatter, key: "tags", value: "{{VALUE}} answer\r\nwork\r\n", config: add, registeredType: null }))
			.toEqual(["old", "{{VALUE}} answer", "work"]);
		expect(frontmatter).toEqual({ tags: ["old"] });
	});
	it("sets each line as an item when the property is known to be a list", () => {
		expect(planPropertyUpdate({ frontmatter: {}, key: "topics", value: "work\npersonal", config: set, registeredType: "multitext" })).toEqual(["work", "personal"]);
		expect(planPropertyUpdate({ frontmatter: { topics: null }, key: "topics", value: "work\npersonal", config: set, registeredType: "list" })).toEqual(["work", "personal"]);
		expect(planPropertyUpdate({ frontmatter: { topics: ["old"] }, key: "topics", value: "work\npersonal", config: set, registeredType: null })).toEqual(["work", "personal"]);
		expect(planPropertyUpdate({ frontmatter: {}, key: "tags", value: "work\nwork\n", config: set, registeredType: null })).toEqual(["work"]);
		expect(planPropertyUpdate({ frontmatter: {}, key: "aliases", value: " \n", config: set, registeredType: null })).toEqual([]);
	});
	it("passes arrays through untouched even when an item contains a line break", () => {
		for (const config of [add, set]) {
			expect(planPropertyUpdate({ frontmatter: {}, key: "topics", value: ["a\nb", "c"], config, registeredType: null })).toEqual(["a\nb", "c"]);
			expect(planPropertyUpdate({ frontmatter: {}, key: "topics", value: ["a,b", " c "], config, registeredType: "multitext" })).toEqual(["a,b", " c "]);
		}
	});
	it("refuses to guess whether several lines are text or a list for a property without a type", () => {
		for (const frontmatter of [{}, { topics: null }]) {
			expect(() => planPropertyUpdate({ frontmatter, key: "topics", value: "work\npersonal", config: set, registeredType: null }))
				.toThrow(/Property 'topics' has no type yet.*2 lines.*'Add to list'/s);
		}
		expect(() => planPropertyUpdate({ frontmatter: {}, key: "topics", value: "a\n\nb\r\nc", config: set, registeredType: null })).toThrow("3 lines");
	});
	it("still sets a single line, a typed text property, or an array without a known type", () => {
		expect(planPropertyUpdate({ frontmatter: {}, key: "topics", value: "work", config: set, registeredType: null })).toBe("work");
		expect(planPropertyUpdate({ frontmatter: {}, key: "topics", value: "Smith, John", config: set, registeredType: null })).toBe("Smith, John");
		expect(planPropertyUpdate({ frontmatter: {}, key: "topics", value: "work\n", config: set, registeredType: null })).toBe("work\n");
		expect(planPropertyUpdate({ frontmatter: {}, key: "topics", value: ["work", "personal"], config: set, registeredType: null })).toEqual(["work", "personal"]);
		expect(planPropertyUpdate({ frontmatter: {}, key: "notes", value: "a\nb", config: set, registeredType: "text" })).toBe("a\nb");
		expect(planPropertyUpdate({ frontmatter: { notes: "old" }, key: "notes", value: "a\nb", config: set, registeredType: null })).toBe("a\nb");
		expect(() => planPropertyUpdate({ frontmatter: {}, key: "count", value: "1\n2", config: set, registeredType: "number" })).toThrow("requires number");
	});
});

describe("{{PROPERTY}} compose writes", () => {
	it("detects the token case-insensitively", () => {
		expect(formatContainsPropertyToken("{{PROPERTY}}")).toBe(true);
		expect(formatContainsPropertyToken("work\n{{property}}\n")).toBe(true);
		expect(formatContainsPropertyToken("work\npersonal")).toBe(false);
	});
	it("stringifies lists as one item per line and scalars as text", () => {
		expect(stringifyPropertyTokenValue(["a", "b"])).toBe("a\nb");
		expect(stringifyPropertyTokenValue([])).toBe("");
		expect(stringifyPropertyTokenValue(undefined)).toBe("");
		expect(stringifyPropertyTokenValue(null)).toBe("");
		expect(stringifyPropertyTokenValue("hello")).toBe("hello");
		expect(stringifyPropertyTokenValue(42)).toBe("42");
		expect(stringifyPropertyTokenValue(true)).toBe("true");
	});
	it("aborts when an existing list item contains a line break", () => {
		expect(() => stringifyPropertyTokenValue(["a\nb", "c"])).toThrow(/line break/);
	});
	it("seeds propertyValue, propertyKey, and list before format", () => {
		const tags = new Map<string, unknown>();
		seedPropertyCaptureVariables(tags, "tags", ["old", "keep"]);
		expect(tags.get("propertyKey")).toBe("tags");
		expect(tags.get("propertyValue")).toEqual(["old", "keep"]);
		expect(tags.get("list")).toEqual(["old", "keep"]);
		const status = new Map<string, unknown>();
		seedPropertyCaptureVariables(status, "status", "Draft");
		expect(status.get("propertyValue")).toBe("Draft");
		expect(status.get("list")).toEqual([]);
		const missing = new Map<string, unknown>();
		seedPropertyCaptureVariables(missing, "rating", undefined);
		expect(missing.get("propertyValue")).toBeUndefined();
		expect(missing.get("list")).toEqual([]);
	});
	it("refuses to overwrite a concrete VALUE answer that shares a seed key", () => {
		const variables = new Map<string, unknown>([["list", "user answer"]]);
		expect(() => seedPropertyCaptureVariables(variables, "tags", ["old"]))
			.toThrow(/cannot seed 'list'.*\{\{VALUE:list\}\}/);
		expect(variables.get("list")).toBe("user answer");
		expect(variables.has("propertyKey")).toBe(false);
	});
	it("still seeds when a prior key was present but undefined", () => {
		const variables = new Map<string, unknown>([["propertyValue", undefined]]);
		seedPropertyCaptureVariables(variables, "tags", ["old"]);
		expect(variables.get("propertyValue")).toEqual(["old"]);
		expect(variables.get("list")).toEqual(["old"]);
	});
	it("restores seed keys so a later capture can seed again", () => {
		const variables = new Map<string, unknown>([["keep", "me"]]);
		const snapshot = snapshotPropertyCaptureSeeds(variables);
		seedPropertyCaptureVariables(variables, "tags", ["old"]);
		expect(variables.get("propertyKey")).toBe("tags");
		restorePropertyCaptureSeeds(variables, snapshot);
		expect(variables.has("propertyKey")).toBe(false);
		expect(variables.has("propertyValue")).toBe(false);
		expect(variables.has("list")).toBe(false);
		expect(variables.get("keep")).toBe("me");
		seedPropertyCaptureVariables(variables, "status", "Draft");
		expect(variables.get("propertyValue")).toBe("Draft");
		restorePropertyCaptureSeeds(variables, snapshot);
		expect(variables.has("propertyValue")).toBe(false);
	});
	it("restores a pre-existing undefined seed entry", () => {
		const variables = new Map<string, unknown>([["propertyValue", undefined]]);
		const snapshot = snapshotPropertyCaptureSeeds(variables);
		seedPropertyCaptureVariables(variables, "tags", ["a"]);
		restorePropertyCaptureSeeds(variables, snapshot);
		expect(variables.has("propertyValue")).toBe(true);
		expect(variables.get("propertyValue")).toBeUndefined();
		expect(variables.has("list")).toBe(false);
	});
	it("inserts above existing items when the composed format puts new lines first", () => {
		const frontmatter = { tags: ["old", "keep"] };
		expect(planPropertyUpdate({
			frontmatter, key: "tags", value: "work\npersonal\nold\nkeep", config: add, registeredType: null, compose: true,
		})).toEqual(["work", "personal", "old", "keep"]);
	});
	it("inserts below existing items when the composed format puts existing lines first", () => {
		const frontmatter = { tags: ["old", "keep"] };
		expect(planPropertyUpdate({
			frontmatter, key: "tags", value: "old\nkeep\nwork\npersonal", config: add, registeredType: null, compose: true,
		})).toEqual(["old", "keep", "work", "personal"]);
	});
	it("keeps the first occurrence when a top insert reorders a duplicate", () => {
		expect(planPropertyUpdate({
			frontmatter: { tags: ["work", "old"] }, key: "tags", value: "work\nwork\nold", config: add, registeredType: null, compose: true,
		})).toEqual(["work", "old"]);
	});
	it("still appends when the token is absent", () => {
		expect(planPropertyUpdate({
			frontmatter: { tags: ["old"] }, key: "tags", value: "work\npersonal", config: add, registeredType: null,
		})).toEqual(["old", "work", "personal"]);
	});
	it("still replaces without the token under Set", () => {
		expect(planPropertyUpdate({
			frontmatter: { tags: ["old"] }, key: "tags", value: "work\npersonal", config: set, registeredType: null,
		})).toEqual(["work", "personal"]);
	});
	it("weaves text under Set with a composed string", () => {
		expect(planPropertyUpdate({
			frontmatter: { status: "Draft" }, key: "status", value: "Draft → Ready", config: set, registeredType: "text",
		})).toBe("Draft → Ready");
	});
	it("keeps the untyped Set multi-line guardrail with compose", () => {
		expect(() => planPropertyUpdate({
			frontmatter: {}, key: "topics", value: "work\npersonal", config: set, registeredType: null, compose: true,
		})).toThrow(/no type yet/);
	});
});

describe("property capture values", () => {
	it.each(["001", "false", "2026-09-07", "[a, b]", "a,b", "", "a\nb"])("keeps plain text %j as text", (value) => {
		expect(planPropertyUpdate({ frontmatter: { status: "active" }, key: "status", value, config: set, registeredType: "text" })).toBe(value);
	});
	it.each([0, false, [], ["one", "two"]])("preserves a new typed value %j", (value) => {
		expect(planPropertyUpdate({ frontmatter: {}, key: "property", value, config: set, registeredType: null })).toEqual(value);
	});
	it("adds distinct items in order without splitting commas or changing existing data", () => {
		const frontmatter = { sources: ["a,b", "old"], status: "active" };
		expect(planPropertyUpdate({ frontmatter, key: "sources", value: ["old", "new", "new"], config: add, registeredType: "multitext" })).toEqual(["a,b", "old", "new"]);
		expect(planPropertyUpdate({ frontmatter, key: "sources", value: "one,two\nthree", config: add, registeredType: null })).toEqual(["a,b", "old", "one,two", "three"]);
		expect(frontmatter).toEqual({ sources: ["a,b", "old"], status: "active" });
	});
	it("can replace and explicitly clear a list", () => {
		expect(planPropertyUpdate({ frontmatter: { tags: ["old"] }, key: "tags", value: [], config: set, registeredType: "tags" })).toEqual([]);
	});
	it.each(["", " \n\n", []])("keeps an empty addition %j from changing the list", (value) => {
		expect(planPropertyUpdate({ frontmatter: { items: ["old", "old"] }, key: "items", value, config: add, registeredType: null })).toEqual(["old", "old"]);
		expect(planPropertyUpdate({ frontmatter: {}, key: "items", value, config: add, registeredType: null })).toEqual([]);
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
