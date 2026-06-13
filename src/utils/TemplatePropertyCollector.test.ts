import type { App } from "obsidian";
import { describe, expect, it } from "vitest";
import { TemplatePropertyCollector } from "./TemplatePropertyCollector";

function idxRange(haystack: string, needle: string): [number, number] {
  const start = haystack.indexOf(needle);
  if (start === -1) throw new Error("needle not found");
  return [start, start + needle.length];
}

function createMockApp(typeMap: Record<string, string>): App {
  return {
    metadataCache: {
      app: {
        metadataTypeManager: {
          getTypeInfo: (key: string) => ({ expected: { type: typeMap[key] } }),
        },
      },
    },
  } as unknown as App;
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
      collectionActive: true, heuristicEnabled: true,
    });

    const [aStart, aEnd] = idxRange(yaml, "{{VALUE:authors}}");
    c.maybeCollect({
      input: yaml,
      matchStart: aStart,
      matchEnd: aEnd,
      rawValue: ["John"],
      fallbackKey: "authors",
      collectionActive: true, heuristicEnabled: true,
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
      collectionActive: true, heuristicEnabled: true,
    });
    expect(c.drain().size).toBe(0);
  });

  it("collects multiple keys", () => {
    const c = new TemplatePropertyCollector();
    const [aStart, aEnd] = idxRange(yaml, "{{VALUE:authors}}");
    c.maybeCollect({ input: yaml, matchStart: aStart, matchEnd: aEnd, rawValue: ["J"], fallbackKey: "authors", collectionActive: true, heuristicEnabled: true });
    const [yStart, yEnd] = idxRange(yaml, "{{VALUE:year}}");
    c.maybeCollect({ input: yaml, matchStart: yStart, matchEnd: yEnd, rawValue: 2024, fallbackKey: "year", collectionActive: true, heuristicEnabled: true });
    const result = c.drain();
    expect(result.get("authors")).toEqual(["J"]);
    expect(result.get("year")).toBe(2024);
  });

  it("collects list variables using parent key context", () => {
    const listYaml = `---\n` +
      `sources:\n` +
      `  - "{{VALUE:sources}}"\n` +
      `description: "{{VALUE:description}}"\n` +
      `---\n`;

    const app = createMockApp({ sources: "multitext", description: "text" });
    const collector = new TemplatePropertyCollector(app);

    const [sourcesStart, sourcesEnd] = idxRange(listYaml, "{{VALUE:sources}}");
    collector.maybeCollect({
      input: listYaml,
      matchStart: sourcesStart,
      matchEnd: sourcesEnd,
      rawValue: "[[alpha]], [[beta]]",
      fallbackKey: "sources",
      collectionActive: true, heuristicEnabled: true,
    });

    const [descStart, descEnd] = idxRange(listYaml, "{{VALUE:description}}");
    collector.maybeCollect({
      input: listYaml,
      matchStart: descStart,
      matchEnd: descEnd,
      rawValue: "Hello, world",
      fallbackKey: "description",
      collectionActive: true, heuristicEnabled: true,
    });

    const result = collector.drain();
    expect(result.get("sources")).toEqual(["[[alpha]]", "[[beta]]"]);
    expect(result.has("description")).toBe(false);
  });

  it("records full path for nested list variables", () => {
    const nestedYaml = `---\n` +
      `project:\n` +
      `  sources:\n` +
      `    - "{{VALUE:sources}}"\n` +
      `---\n`;

    const app = createMockApp({ sources: "multitext" });
    const collector = new TemplatePropertyCollector(app);

    const [start, end] = idxRange(nestedYaml, "{{VALUE:sources}}");
    collector.maybeCollect({
      input: nestedYaml,
      matchStart: start,
      matchEnd: end,
      rawValue: "alpha, beta",
      fallbackKey: "sources",
      collectionActive: true, heuristicEnabled: true,
    });

    const result = collector.drain();
    const key = ['project', 'sources'].join(TemplatePropertyCollector.PATH_SEPARATOR);
    expect(result.get(key)).toEqual(['alpha', 'beta']);
  });
});

// Regression coverage for issue #662: structured-value collection is decoupled
// from the `enableTemplatePropertyTypes` beta flag, while the string -> structured
// heuristic stays gated. Uses a stub matching the REAL runtime where
// metadataTypeManager.getTypeInfo always returns a type (never null) - the
// condition under which the old string heuristic is effectively dead.
describe("TemplatePropertyCollector #662 flag decoupling", () => {
  const yaml = `---\ncast: {{VALUE:cast}}\n---\nbody`;
  const [start, end] = idxRange(yaml, "{{VALUE:cast}}");
  const realRuntimeApp = {
    metadataCache: {
      app: {
        metadataTypeManager: {
          // Real Obsidian defaults every key to "text", even never-seen keys.
          getTypeInfo: () => ({ expected: { type: "text" }, inferred: { type: "text" } }),
        },
      },
    },
  } as unknown as App;

  function collectCast(args: Partial<Parameters<TemplatePropertyCollector["maybeCollect"]>[0]> & { rawValue: unknown }) {
    const c = new TemplatePropertyCollector(realRuntimeApp);
    c.maybeCollect({
      input: yaml,
      matchStart: start,
      matchEnd: end,
      fallbackKey: "cast",
      collectionActive: true,
      heuristicEnabled: false,
      ...args,
    });
    return c.drain();
  }

  it("collects real arrays with the beta flag OFF (heuristicEnabled false)", () => {
    const result = collectCast({ rawValue: ["[[A]]", "[[B]]"] });
    expect(result.get("cast")).toEqual(["[[A]]", "[[B]]"]);
  });

  it("collects plain objects with the flag OFF (containers break when inlined)", () => {
    expect(collectCast({ rawValue: { a: 1 } }).get("cast")).toEqual({ a: 1 });
  });

  it("does NOT collect bare numbers/booleans with the flag OFF (YAML-safe inline, avoids churn)", () => {
    expect(collectCast({ rawValue: 42 }).size).toBe(0);
    expect(collectCast({ rawValue: true }).size).toBe(0);
  });

  it("DOES collect numbers/booleans when the heuristic flag is ON (preserves beta behaviour)", () => {
    expect(collectCast({ rawValue: 42, heuristicEnabled: true }).get("cast")).toBe(42);
    expect(collectCast({ rawValue: true, heuristicEnabled: true }).get("cast")).toBe(true);
  });

  it("does NOT collect plain strings (left raw so valid frontmatter stays byte-identical)", () => {
    expect(collectCast({ rawValue: "[[A]]" }).size).toBe(0);
  });

  it("does NOT run the string->list heuristic when the flag is OFF", () => {
    // A comma string that the heuristic WOULD split, but the flag is off.
    expect(collectCast({ rawValue: "[[A]], [[B]]" }).size).toBe(0);
  });

  it("still will not split a string under the real-runtime 'text' type even with the flag ON (heuristic is type-gated)", () => {
    // Pins the known limitation that motivated the array-based fix: with
    // getTypeInfo() -> 'text', the bullet/comma heuristic cannot fire.
    const result = collectCast({ rawValue: "[[A]], [[B]]", heuristicEnabled: true });
    expect(result.size).toBe(0);
  });

  it("collects nothing when collection is not active", () => {
    expect(collectCast({ rawValue: ["[[A]]"], collectionActive: false }).size).toBe(0);
  });
});
