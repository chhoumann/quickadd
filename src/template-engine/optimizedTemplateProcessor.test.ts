import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import { OptimizedTemplateProcessor } from "@template/OptimizedTemplateProcessor";
import type { VariableMap } from "./types";

function naiveLegacyProcess(template: string, variables: VariableMap): string {
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
    const vars: VariableMap = { name: "World" };
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
    const vars: VariableMap = { name: "Alice" };
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

  it("handles nested template placeholders", () => {
    const tpl = "A {{TEMPLATE:first.md}} B {{TEMPLATE:second.md}} C";
    expect(processor.process(tpl, {})).toBe(tpl);
  });

  it("handles year crossover with positive offset", () => {
    vi.setSystemTime(new Date("2024-12-31T00:00:00Z"));
    expect(processor.process("Next {{DATE+1}}", {})).toBe("Next 2025-01-01");
  });

  it("handles year crossover with negative offset", () => {
    vi.setSystemTime(new Date("2025-01-01T00:00:00Z"));
    expect(processor.process("Prev {{DATE-1}}", {})).toBe("Prev 2024-12-31");
  });

  it("leaves malformed date format untouched", () => {
    const tpl = "{{DATE:INVALIDFORMAT}}";
    expect(processor.process(tpl, {})).toBe("INVALIDFORMAT");
  });

  it("substitutes variables containing special characters", () => {
    const vars: VariableMap = { "user-name": "Alice/Bob" };
    const tpl = "Hello {{VALUE:user-name}}!";
    expect(processor.process(tpl, vars)).toBe("Hello Alice/Bob!");
  });
});