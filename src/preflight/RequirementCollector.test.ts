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

  it("collects VALUE text mappings for option lists", async () => {
    const app = makeApp();
    const plugin = makePlugin();
    const rc = new RequirementCollector(app, plugin);
    await rc.scanString("{{VALUE:🔼,⏫|text:Normal,High}}");

    const requirement = rc.requirements.get("🔼,⏫");
    expect(requirement?.options).toEqual(["🔼", "⏫"]);
    expect(requirement?.displayOptions).toEqual(["Normal", "High"]);
  });

  it("throws when VALUE text mappings have mismatched lengths", async () => {
    const app = makeApp();
    const plugin = makePlugin();
    const rc = new RequirementCollector(app, plugin);

    await expect(
      rc.scanString("{{VALUE:a,b|text:Only One}}"),
    ).rejects.toThrow(/same number of text entries and item entries/i);
  });

  it("does not treat case option as a legacy default for named VALUE", async () => {
    const app = makeApp();
    const plugin = makePlugin();
    const rc = new RequirementCollector(app, plugin);
    await rc.scanString("{{VALUE:title|case:kebab}}");

    const requirement = rc.requirements.get("title");
    expect(requirement?.defaultValue).toBeUndefined();
  });

  it("does not treat case option as a legacy default for unnamed VALUE", async () => {
    const app = makeApp();
    const plugin = makePlugin();
    const rc = new RequirementCollector(app, plugin);
    await rc.scanString("{{VALUE|case:kebab|label:Notes}}");

    const requirement = rc.requirements.get("value");
    expect(requirement?.description).toBe("Notes");
    expect(requirement?.defaultValue).toBeUndefined();
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

  it("collects frontmatter VDATE and neighboring VALUE dropdowns", async () => {
    const app = makeApp();
    const plugin = makePlugin();
    const rc = new RequirementCollector(app, plugin);
    await rc.scanString(`---
Date: {{VDATE:Due Date, YYYY-MM-DD}}
Priority: {{VALUE:Low,Medium,High|label:Priority}}
Status: {{VALUE:Todo,Doing,Done|label:Status}}
---
Body`);

    const due = rc.requirements.get("Due Date");
    expect(due).toMatchObject({
      id: "Due Date",
      label: "Due Date",
      type: "date",
      dateFormat: "YYYY-MM-DD",
    });
    expect(
      Array.from(rc.requirements.values()).find(
        (requirement) => requirement.label === "Priority",
      ),
    ).toMatchObject({
      type: "dropdown",
      options: ["Low", "Medium", "High"],
    });
    expect(
      Array.from(rc.requirements.values()).find(
        (requirement) => requirement.label === "Status",
      ),
    ).toMatchObject({
      type: "dropdown",
      options: ["Todo", "Doing", "Done"],
    });
  });

  it("collects no-format VDATE with the default date format", async () => {
    const app = makeApp();
    const plugin = makePlugin();
    const rc = new RequirementCollector(app, plugin);
    await rc.scanString("Date: {{VDATE:Due Date}}");

    expect(rc.requirements.get("Due Date")).toMatchObject({
      id: "Due Date",
      label: "Due Date",
      type: "date",
      dateFormat: "YYYY-MM-DD",
    });
  });

  it("collects lowercase and whitespace-tolerant VDATE syntax", async () => {
    const app = makeApp();
    const plugin = makePlugin();
    const rc = new RequirementCollector(app, plugin);
    await rc.scanString("{{vdate: due date , YYYY-MM-DD | tomorrow }}");

    expect(rc.requirements.get("due date")).toMatchObject({
      type: "date",
      dateFormat: "YYYY-MM-DD",
      defaultValue: "tomorrow",
    });
  });

  it("records TEMPLATE references for recursive scanning", async () => {
    const app = makeApp();
    const plugin = makePlugin();
    const rc = new RequirementCollector(app, plugin);
    await rc.scanString("{{TEMPLATE:Templates/Note}}" );

    expect(rc.templatesToScan.size === 0 || rc.templatesToScan.has("Templates/Note")).toBe(true);
  });

  it("records .base TEMPLATE references for recursive scanning", async () => {
    const app = makeApp();
    const plugin = makePlugin();
    const rc = new RequirementCollector(app, plugin);
    await rc.scanString("{{TEMPLATE:Templates/Kanban.base}}" );

    expect(rc.templatesToScan.has("Templates/Kanban.base")).toBe(true);
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
