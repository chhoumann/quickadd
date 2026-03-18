import { describe, expect, it } from "vitest";
import {
	coerceYamlValue,
	getYamlPlaceholder,
	isStructuredYamlValue,
} from "./yamlValues";

describe("coerceYamlValue", () => {
  it("converts @date:ISO to Date", () => {
    const iso = "2025-01-02T03:04:05.000Z";
    const v = coerceYamlValue(`@date:${iso}`);
    expect(v).toBeInstanceOf(Date);
    expect((v as Date).toISOString()).toBe(iso);
  });

  it("passes through invalid @date prefix string", () => {
    const s = "@date:not-a-date";
    const v = coerceYamlValue(s);
    expect(v).toBe(s);
  });

  it("passes through non-strings", () => {
    expect(coerceYamlValue(42)).toBe(42);
    const obj = { a: 1 };
    expect(coerceYamlValue(obj)).toBe(obj);
    const arr = [1, 2];
    expect(coerceYamlValue(arr)).toBe(arr);
  });
});

describe("isStructuredYamlValue", () => {
	it("accepts structured YAML property values", () => {
		expect(isStructuredYamlValue(["a"])).toBe(true);
		expect(isStructuredYamlValue({ a: 1 })).toBe(true);
		expect(isStructuredYamlValue(42)).toBe(true);
		expect(isStructuredYamlValue(false)).toBe(true);
		expect(isStructuredYamlValue(null)).toBe(true);
	});

	it("rejects plain string placeholders", () => {
		expect(isStructuredYamlValue("hello")).toBe(false);
		expect(isStructuredYamlValue(undefined)).toBe(false);
	});
});

describe("getYamlPlaceholder", () => {
	it("returns YAML-safe placeholders for structured values", () => {
		expect(getYamlPlaceholder(["a"])).toBe("[]");
		expect(getYamlPlaceholder({ a: 1 })).toBe("{}");
		expect(getYamlPlaceholder(42)).toBe("42");
		expect(getYamlPlaceholder(true)).toBe("true");
		expect(getYamlPlaceholder(null)).toBe("null");
	});

	it("returns undefined for non-structured values", () => {
		expect(getYamlPlaceholder("hello")).toBeUndefined();
		expect(getYamlPlaceholder(undefined)).toBeUndefined();
	});
});
