import { describe, it, expect } from "vitest";
import { RequirementCollector } from "./RequirementCollector";
import { buildValueVariableKey } from "src/utils/valueSyntax";

// Light stubs for app/plugin
const makeApp = () => ({
  workspace: { getActiveFile: () => null },
  vault: { getAbstractFileByPath: () => null, cachedRead: async () => "" },
} as any);
const makePlugin = (overrides: Record<string, unknown> = {}) =>
  ({
    settings: {
      inputPrompt: "single-line",
      globalVariables: {},
      ...overrides,
    },
  } as any);

describe("RequirementCollector", () => {
  it("collects VALUE with default and options", async () => {
    const app = makeApp();
    const plugin = makePlugin();
    const rc = new RequirementCollector(app, plugin);
    await rc.scanString("{{VALUE:title|Untitled}} and {{VALUE:low,medium,high}}" );

    const reqs = Array.from(rc.requirements.values());
    const byId = Object.fromEntries(reqs.map(r => [r.id, r]));

    expect(byId["title"].defaultValue).toBe("Untitled");
    expect(byId["low,medium,high"].type).toBe("dropdown");
  });

  it("collects VALUE labels for single and multi inputs", async () => {
    const app = makeApp();
    const plugin = makePlugin();
    const rc = new RequirementCollector(app, plugin);
    const multiToken = "low,medium,high|label:Priority";
    await rc.scanString(
      `{{VALUE:title|label:Snake cased name}} and {{VALUE:${multiToken}}}`,
    );

    const reqs = Array.from(rc.requirements.values());
    const byId = Object.fromEntries(reqs.map((r) => [r.id, r]));

    expect(byId["title"].label).toBe("title");
    expect(byId["title"].description).toBe("Snake cased name");
    const variableKey = buildValueVariableKey(
      "low,medium,high",
      "Priority",
      true,
    );
    expect(byId[variableKey].label).toBe("Priority");
    expect(byId[variableKey].type).toBe("dropdown");
  });

  it("collects VDATE with format and default", async () => {
    const app = makeApp();
    const plugin = makePlugin();
    const rc = new RequirementCollector(app, plugin);
    await rc.scanString("{{VDATE:due, YYYY-MM-DD|tomorrow}}" );

    const [due] = Array.from(rc.requirements.values()).filter(r => r.id === "due");
    expect(due.type).toBe("date");
    expect(due.dateFormat).toBe("YYYY-MM-DD");
    expect(due.defaultValue).toBe("tomorrow");
  });

  it("records TEMPLATE references for recursive scanning", async () => {
    const app = makeApp();
    const plugin = makePlugin();
    const rc = new RequirementCollector(app, plugin);
    await rc.scanString("{{TEMPLATE:Templates/Note}}" );

    expect(rc.templatesToScan.size === 0 || rc.templatesToScan.has("Templates/Note")).toBe(true);
  });

  it("uses textarea for VALUE tokens with type:multiline", async () => {
    const app = makeApp();
    const plugin = makePlugin({ inputPrompt: "single-line" });
    const rc = new RequirementCollector(app, plugin);
    await rc.scanString("{{VALUE:Body|type:multiline}}" );

    const requirement = rc.requirements.get("Body");
    expect(requirement?.type).toBe("textarea");
  });

  it("uses textarea for unnamed VALUE with type:multiline", async () => {
    const app = makeApp();
    const plugin = makePlugin({ inputPrompt: "single-line" });
    const rc = new RequirementCollector(app, plugin);
    await rc.scanString("{{VALUE|type:multiline|label:Notes}}" );

    const requirement = rc.requirements.get("value");
    expect(requirement?.type).toBe("textarea");
    expect(requirement?.description).toBe("Notes");
  });

  it("respects global multiline setting for named VALUE tokens", async () => {
    const app = makeApp();
    const plugin = makePlugin({ inputPrompt: "multi-line" });
    const rc = new RequirementCollector(app, plugin);
    await rc.scanString("{{VALUE:title}}" );

    const requirement = rc.requirements.get("title");
    expect(requirement?.type).toBe("textarea");
  });
});
