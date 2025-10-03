import { describe, expect, it } from "vitest";
import { TemplatePropertyCollector } from "./TemplatePropertyCollector";

function idxRange(haystack: string, needle: string): [number, number] {
  const start = haystack.indexOf(needle);
  if (start === -1) throw new Error("needle not found");
  return [start, start + needle.length];
}

describe("TemplatePropertyCollector", () => {
  const yaml = `---\n` +
    `title: "{{VALUE:title}}"\n` +
    `authors: {{VALUE:authors}}\n` +
    `inline: something {{VALUE:inline}} trailing\n` +
    `year: {{VALUE:year}}\n` +
    `---\nbody`; 

  it("collects variables in key-value slots including quoted", () => {
    const c = new TemplatePropertyCollector();

    const [tStart, tEnd] = idxRange(yaml, "{{VALUE:title}}");
    c.maybeCollect({
      input: yaml,
      matchStart: tStart,
      matchEnd: tEnd,
      rawValue: ["A"],
      fallbackKey: "title",
      featureEnabled: true,
    });

    const [aStart, aEnd] = idxRange(yaml, "{{VALUE:authors}}");
    c.maybeCollect({
      input: yaml,
      matchStart: aStart,
      matchEnd: aEnd,
      rawValue: ["John"],
      fallbackKey: "authors",
      featureEnabled: true,
    });

    const result = c.drain();
    expect([...result.keys()].sort()).toEqual(["authors", "title"]);
  });

  it("ignores placeholders not in a pure key-value position", () => {
    const c = new TemplatePropertyCollector();
    const [iStart, iEnd] = idxRange(yaml, "{{VALUE:inline}}");
    c.maybeCollect({
      input: yaml,
      matchStart: iStart,
      matchEnd: iEnd,
      rawValue: [1],
      fallbackKey: "inline",
      featureEnabled: true,
    });
    expect(c.drain().size).toBe(0);
  });

  it("collects multiple keys", () => {
    const c = new TemplatePropertyCollector();
    const [aStart, aEnd] = idxRange(yaml, "{{VALUE:authors}}");
    c.maybeCollect({ input: yaml, matchStart: aStart, matchEnd: aEnd, rawValue: ["J"], fallbackKey: "authors", featureEnabled: true });
    const [yStart, yEnd] = idxRange(yaml, "{{VALUE:year}}");
    c.maybeCollect({ input: yaml, matchStart: yStart, matchEnd: yEnd, rawValue: 2024, fallbackKey: "year", featureEnabled: true });
    const result = c.drain();
    expect(result.get("authors")).toEqual(["J"]);
    expect(result.get("year")).toBe(2024);
  });
});
