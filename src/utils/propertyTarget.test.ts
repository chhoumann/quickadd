import { describe, expect, it } from "vitest";
import { isPropertyTarget, parsePropertyTarget } from "./propertyTarget";

describe("parsePropertyTarget", () => {
	it("returns null for a non-property target", () => {
		expect(parsePropertyTarget("Notes/Inbox.md")).toBeNull();
		expect(parsePropertyTarget("#people")).toBeNull();
		expect(parsePropertyTarget("")).toBeNull();
		expect(parsePropertyTarget("Projects/")).toBeNull();
	});

	it("parses field=value equality", () => {
		expect(parsePropertyTarget("property:type=draft")).toEqual({
			field: "type",
			value: "draft",
			filter: {},
		});
	});

	it("parses a value-less target as presence mode (undefined value)", () => {
		expect(parsePropertyTarget("property:type")).toEqual({
			field: "type",
			value: undefined,
			filter: {},
		});
	});

	it("treats an empty value after '=' as presence mode", () => {
		expect(parsePropertyTarget("property:type=")).toEqual({
			field: "type",
			value: undefined,
			filter: {},
		});
	});

	it("matches the prefix case-insensitively", () => {
		expect(parsePropertyTarget("PROPERTY:type=draft")?.field).toBe("type");
		expect(parsePropertyTarget("Property:Type=Draft")).toEqual({
			field: "Type",
			value: "Draft",
			filter: {},
		});
	});

	it("trims whitespace around field and value", () => {
		expect(parsePropertyTarget("property: type = draft ")).toEqual({
			field: "type",
			value: "draft",
			filter: {},
		});
	});

	it("splits on the FIRST '=' so values may contain '='", () => {
		expect(parsePropertyTarget("property:expr=a=b")).toEqual({
			field: "expr",
			value: "a=b",
			filter: {},
		});
	});

	it("returns an empty field for a malformed target (caller aborts)", () => {
		expect(parsePropertyTarget("property:")).toEqual({
			field: "",
			value: undefined,
			filter: {},
		});
		expect(parsePropertyTarget("property:=draft")).toEqual({
			field: "",
			value: "draft",
			filter: {},
		});
	});

	it("reserves '|' for pipe filters and parses them via the shared FIELD grammar", () => {
		expect(parsePropertyTarget("property:type=draft|folder:Notes")).toEqual({
			field: "type",
			value: "draft",
			filter: { folder: "Notes" },
		});
		const parsed = parsePropertyTarget(
			"property:type=draft|exclude-folder:Archive|exclude-tag:done",
		);
		expect(parsed?.field).toBe("type");
		expect(parsed?.value).toBe("draft");
		expect(parsed?.filter.excludeFolders).toEqual(["Archive"]);
		expect(parsed?.filter.excludeTags).toEqual(["done"]);
	});

	it("does not let a '|' bleed into the value (reserved)", () => {
		expect(parsePropertyTarget("property:type=a|b")?.value).toBe("a");
	});
});

describe("isPropertyTarget", () => {
	it("detects the prefix case-insensitively, ignoring surrounding whitespace", () => {
		expect(isPropertyTarget("property:type=draft")).toBe(true);
		expect(isPropertyTarget("  PROPERTY:type  ")).toBe(true);
		expect(isPropertyTarget("Notes/Inbox.md")).toBe(false);
		expect(isPropertyTarget("#tag")).toBe(false);
	});
});
