import { describe, expect, it } from "vitest";
import { assertAssignableVariableName } from "./assignableVariable";

describe("assertAssignableVariableName", () => {
	it("rejects the formatter-reserved names", () => {
		for (const name of ["value", "title", "text", "meta"]) {
			expect(() => assertAssignableVariableName(name)).toThrow(/reserved/);
		}
	});

	it("rejects formatter-reserved names case-insensitively", () => {
		// The formatter resolves {{VALUE:name}} case-insensitively
		// (resolveExistingVariableKey -> findCaseInsensitiveMatch), so a case
		// variant must be rejected just like the lowercase form - otherwise
		// `assignToVariable: "Value"` slips the guard and hijacks {{VALUE:value}}.
		for (const name of [
			"Value",
			"VALUE",
			"Title",
			"TITLE",
			"Text",
			"TEXT",
			"Meta",
			"META",
		]) {
			expect(() => assertAssignableVariableName(name)).toThrow(/reserved/);
		}
	});

	it("rejects a reserved name with surrounding whitespace", () => {
		expect(() => assertAssignableVariableName("  Value  ")).toThrow(/reserved/);
	});

	it("rejects the reserved internal namespace case-insensitively", () => {
		expect(() => assertAssignableVariableName("__qa.foo")).toThrow(/__qa\./);
		expect(() => assertAssignableVariableName("__QA.foo")).toThrow(/__qa\./);
	});

	it("rejects names that collide with the quoted output variable", () => {
		expect(() => assertAssignableVariableName("city-quoted")).toThrow(
			/-quoted/,
		);
	});

	it("rejects the quoted-output collision case-insensitively", () => {
		// The formatter resolves {{VALUE:name}} case-insensitively, so a case
		// variant of the `-quoted` suffix would still collide with the
		// auto-generated `${key}-quoted` companion variable.
		expect(() => assertAssignableVariableName("summary-Quoted")).toThrow(
			/-quoted/,
		);
		expect(() => assertAssignableVariableName("summary-QUOTED")).toThrow(
			/-quoted/,
		);
	});

	it("rejects names unreachable by the {{VALUE:name}} grammar", () => {
		expect(() => assertAssignableVariableName("a|b")).toThrow(/unreachable/);
		expect(() => assertAssignableVariableName("a,b")).toThrow(/unreachable/);
	});

	it("rejects an empty name", () => {
		expect(() => assertAssignableVariableName("   ")).toThrow(/empty/);
	});

	it("allows a normal author-chosen variable name", () => {
		expect(() => assertAssignableVariableName("category")).not.toThrow();
		expect(() => assertAssignableVariableName("My Value Notes")).not.toThrow();
	});
});
