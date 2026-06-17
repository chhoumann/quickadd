import { describe, it, expect } from "vitest";
import {
	assertRegisterableSchema,
	validateValue,
	ToolSchemaError,
} from "./jsonSchemaValidator";
import type { JSONSchema } from "./NormalizedTools";

describe("assertRegisterableSchema", () => {
	it("accepts the supported subset", () => {
		expect(() =>
			assertRegisterableSchema({
				type: "object",
				properties: {
					name: { type: "string", description: "a name" },
					count: { type: "integer" },
					tags: { type: "array", items: { type: "string" } },
					mode: { type: "string", enum: ["a", "b"] },
				},
				required: ["name"],
			}),
		).not.toThrow();
	});

	it("rejects unsupported keywords that a provider would silently drop", () => {
		const bad: JSONSchema[] = [
			{ type: "string", pattern: "^x" },
			{ type: "string", minLength: 2 },
			{ type: "object", additionalProperties: false },
			{ $ref: "#/defs/x" },
			{ allOf: [{ type: "object" }] },
			{ anyOf: [{ type: "string" }] },
			{ type: "string", format: "email" },
			{ type: "number", minimum: 0 },
		];
		for (const schema of bad) {
			expect(() => assertRegisterableSchema(schema)).toThrow(ToolSchemaError);
		}
	});

	it("recurses into properties and items", () => {
		expect(() =>
			assertRegisterableSchema({
				type: "object",
				properties: { nested: { type: "object", properties: { x: { type: "string", pattern: "y" } } } },
			}),
		).toThrow(ToolSchemaError);
		expect(() =>
			assertRegisterableSchema({ type: "array", items: { type: "string", format: "uri" } }),
		).toThrow(ToolSchemaError);
	});

	it("rejects invalid type names and malformed required", () => {
		expect(() => assertRegisterableSchema({ type: "stringy" as never })).toThrow(
			ToolSchemaError,
		);
		expect(() =>
			assertRegisterableSchema({ type: "object", required: "name" as never }),
		).toThrow(ToolSchemaError);
	});

	it("rejects tuple-style items (an array of schemas) — not validated at runtime", () => {
		expect(() =>
			assertRegisterableSchema({
				type: "array",
				items: [{ type: "string" }, { type: "integer" }] as never,
			}),
		).toThrow(ToolSchemaError);
	});
});

describe("validateValue", () => {
	const schema = {
		type: "object" as const,
		properties: {
			path: { type: "string" as const },
			count: { type: "integer" as const },
			mode: { type: "string" as const, enum: ["top", "bottom"] },
			tags: { type: "array" as const, items: { type: "string" as const } },
		},
		required: ["path"],
	};

	it("passes a valid value", () => {
		expect(
			validateValue({ path: "a.md", count: 3, mode: "top", tags: ["x", "y"] }, schema),
		).toBeNull();
	});

	it("flags a missing required property", () => {
		expect(validateValue({ count: 1 }, schema)).toMatch(/required/);
	});

	it("treats an inherited (prototype) property as missing for required (own-property check)", () => {
		// `toString` exists on the prototype but not as an own property → must be flagged.
		expect(validateValue({}, { type: "object", required: ["toString"] })).toMatch(/required/);
	});

	it("flags a wrong type", () => {
		expect(validateValue({ path: 42 }, schema)).toMatch(/expected string/);
		expect(validateValue({ path: "a", count: 1.5 }, schema)).toMatch(/integer/);
	});

	it("flags an out-of-enum value", () => {
		expect(validateValue({ path: "a", mode: "middle" }, schema)).toMatch(/enum/);
	});

	it("validates array item types", () => {
		expect(validateValue({ path: "a", tags: ["ok", 3] }, schema)).toMatch(/expected string/);
	});

	it("accepts an integer where number is expected", () => {
		expect(validateValue(3, { type: "number" })).toBeNull();
	});
});
