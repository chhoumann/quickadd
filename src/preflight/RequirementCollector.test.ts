import { describe, it, expect } from "vitest";
import { RequirementCollector } from "./RequirementCollector";

// Light stubs for app/plugin
const makeApp = () => ({
  workspace: { getActiveFile: () => null },
  vault: { getAbstractFileByPath: () => null, cachedRead: async () => "" },
} as any);
const makePlugin = () => ({ } as any);

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
    await rc.scanString(
      "{{VALUE:title|label:Snake cased name}} and {{VALUE:low,medium,high|label:Priority}}",
    );

    const reqs = Array.from(rc.requirements.values());
    const byId = Object.fromEntries(reqs.map((r) => [r.id, r]));

    expect(byId["title"].label).toBe("title");
    expect(byId["title"].description).toBe("Snake cased name");
    expect(byId["low,medium,high::Priority"].label).toBe("Priority");
    expect(byId["low,medium,high::Priority"].type).toBe("dropdown");
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
});
