// @ts-nocheck
import { describe, it, expect } from "vitest";
import { OptimizedTemplateProcessor } from "./OptimizedTemplateProcessor";
import { Variables } from "./types";

function naiveLegacyProcess(template: string, variables: Variables): string {
  let output = template;
  output = output.replace(/{{VALUE:([^}|]+)(?:\|([^}]*))?}}/gi, (_m, name: string, def?: string) => {
    const val = variables[name.trim()];
    if (val === undefined || val === null || val === "") return def ?? "";
    return String(val);
  });

  output = output.replace(/{{DATE}}/gi, () => {
    const date = new Date();
    const two = (n: number) => (n < 10 ? `0${n}` : `${n}`);
    return `${date.getFullYear()}-${two(date.getMonth() + 1)}-${two(date.getDate())}`;
  });

  return output;
}

describe("OptimizedTemplateProcessor", () => {
  const processor = new OptimizedTemplateProcessor();

  it("replaces simple variables", () => {
    const tpl = "Hello {{VALUE:name}}!";
    const vars: Variables = { name: "World" };
    expect(processor.process(tpl, vars)).toBe("Hello World!");
  });

  it("uses default when variable missing", () => {
    const tpl = "{{VALUE:missing|foo}}";
    expect(processor.process(tpl, {})).toBe("foo");
  });

  it("keeps template include placeholders", () => {
    const tpl = "Start {{TEMPLATE:file.md}} End";
    expect(processor.process(tpl, {})).toBe(tpl);
  });

  it("matches naive legacy implementation on mixed template", () => {
    const tpl = "{{DATE}} - {{VALUE:name}} - {{VALUE:missing|bar}}";
    const vars: Variables = { name: "Alice" };
    const optimized = processor.process(tpl, vars);
    const legacy = naiveLegacyProcess(tpl, vars);
    expect(optimized).toBe(legacy);
  });
});