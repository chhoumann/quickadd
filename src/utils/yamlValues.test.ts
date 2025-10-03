import { describe, expect, it } from "vitest";
import { coerceYamlValue } from "./yamlValues";

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
