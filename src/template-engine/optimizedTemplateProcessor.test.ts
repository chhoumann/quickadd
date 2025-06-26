import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import { OptimizedTemplateProcessor } from "./OptimizedTemplateProcessor";
import type { Variables } from "./types";

function naiveLegacyProcess(template: string, variables: Variables): string {
  let output = template;
  output = output.replace(/{{VALUE:([^}|]+)(?:\|([^}]*))?}}/gi, (_m, name: string, def?: string) => {
    const val = variables[name.trim()];
    if (val === undefined || val === null || val === "") return def ?? "";
    return String(val);
  });

  const two = (n: number) => (n < 10 ? `0${n}` : `${n}`);

  const iso = (d: Date) => `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())}`;

  output = output.replace(/{{DATE}}/gi, () => iso(new Date()));

  output = output.replace(/{{DATE:([^}]+)}}/gi, (_m, fmt: string) => {
    if (fmt.trim() === "YYYY-MM-DD") return iso(new Date());
    return iso(new Date());
  });

  output = output.replace(/{{DATE([+\-]\d+)}}/gi, (_m, off: string) => {
    const base = new Date();
    base.setDate(base.getDate() + parseInt(off, 10));
    return iso(base);
  });

  return output;
}

describe("OptimizedTemplateProcessor", () => {
  const processor = new OptimizedTemplateProcessor();

  beforeAll(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2025-01-02T03:04:05Z"));
  });

  afterAll(() => {
    vi.useRealTimers();
  });

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

  it("formats DATE token in ISO form", () => {
    expect(processor.process("Today is {{DATE}}", {})).toBe("Today is 2025-01-02");
  });

  it("formats DATE with offset", () => {
    expect(processor.process("Tomorrow {{DATE+1}}", {})).toBe("Tomorrow 2025-01-03");
  });
});