import { describe, expect, it } from "vitest";
import { inheritPropertyValueType, stringifyPropertyTokenValue, untypedPropertyValueVariable } from "./propertyCaptureFormat";

describe("property input type inheritance", () => {
	it.each(["{{VALUE}}", "{{NAME}}", "{{VALUE:rating}}", "{{VALUE:rating|optional}}"])("inherits the native widget for %s", (format) => {
		expect(inheritPropertyValueType(format, "number")).toBe(`${format.slice(0, -2)}|type:number}}`);
		expect(inheritPropertyValueType(format, "checkbox")).toBe(`${format.slice(0, -2)}|type:checkbox}}`);
	});
	it.each(["{{VALUE:rating|type:text}}", "{{VALUE:rating|type:number}}", "{{VALUE:rating}} points", "{{VALUE:a,b|multi}}", "{{VALUE:rating|case:upper}}", "{{FIELD:rating}}", "42"])("keeps an explicit or composite format %s", (format) => {
		expect(inheritPropertyValueType(format, "number")).toBe(format);
		expect(untypedPropertyValueVariable(format)).toBeNull();
	});
	it("keeps an unregistered property as plain text and retains named variable identity", () => {
		expect(inheritPropertyValueType("{{VALUE:rating}}", null)).toBe("{{VALUE:rating}}");
		expect(untypedPropertyValueVariable("{{VALUE:rating|label:Score}}" )).toBe("rating");
	});
});

describe("{{PROPERTY}} expansion of the current value", () => {
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
});
