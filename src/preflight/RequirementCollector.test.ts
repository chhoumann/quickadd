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

  // Regression: issue #1184 — FIELD requirements were registered under the
  // bare field name ("People") while the runtime formatter looks up the
  // prefixed key ("FIELD:People"), so one-page values were lost and the
  // user was prompted a second time.
  describe("FIELD requirements (issue #1184)", () => {
    it("registers FIELD requirements under the runtime FIELD: key", async () => {
      const app = makeApp();
      const plugin = makePlugin();
      const rc = new RequirementCollector(app, plugin);
      await rc.scanString("People: {{FIELD:People}}");

      expect(rc.requirements.get("FIELD:People")).toMatchObject({
        id: "FIELD:People",
        label: "People",
        type: "field-suggest",
      });
      expect(rc.requirements.has("People")).toBe(false);
    });

    it("keeps filters in the FIELD requirement id so runtime lookup matches", async () => {
      const app = makeApp();
      const plugin = makePlugin();
      const rc = new RequirementCollector(app, plugin);
      await rc.scanString("{{FIELD:People|folder:Contacts}}");

      expect(rc.requirements.get("FIELD:People|folder:Contacts")).toMatchObject({
        id: "FIELD:People|folder:Contacts",
        type: "field-suggest",
      });
    });
  });
});

describe("RequirementCollector — named suggester (issue #148)", () => {
  it("keys a named suggester on the name and dedups with the reuse site", async () => {
    const rc = new RequirementCollector(makeApp(), makePlugin());
    await rc.scanString(
      "# {{VALUE:work,home,errand|name:category}}\ntags: #{{VALUE:category}}",
    );

    // Exactly one requirement, keyed by the name, rendered as a dropdown.
    expect(rc.requirements.has("category")).toBe(true);
    expect(rc.requirements.get("category")).toMatchObject({
      id: "category",
      type: "dropdown",
      options: ["work", "home", "errand"],
    });
    // No stray requirement under the option-list string.
    expect(rc.requirements.has("work,home,errand")).toBe(false);
  });

  it("upgrades a reuse-first requirement to a dropdown (order-independent)", async () => {
    const rc = new RequirementCollector(makeApp(), makePlugin());
    // Bare reuse appears BEFORE the definition.
    await rc.scanString(
      "tags: #{{VALUE:category}}\ntitle: {{VALUE:work,home|name:category}}",
    );

    expect(rc.requirements.get("category")).toMatchObject({
      type: "dropdown",
      options: ["work", "home"],
    });
  });

  it("upgrades across separate scanned strings (filename then body)", async () => {
    const rc = new RequirementCollector(makeApp(), makePlugin());
    await rc.scanString("{{VALUE:category}}"); // filename: reuse first
    await rc.scanString("{{VALUE:a,b,c|name:category}}"); // body: definition

    expect(rc.requirements.get("category")).toMatchObject({
      type: "dropdown",
      options: ["a", "b", "c"],
    });
  });

  it("records a custom-input named list as a suggester", async () => {
    const rc = new RequirementCollector(makeApp(), makePlugin());
    await rc.scanString("{{VALUE:a,b|name:category|custom}}");

    expect(rc.requirements.get("category")).toMatchObject({
      type: "suggester",
      options: ["a", "b"],
    });
    expect(rc.requirements.get("category")?.suggesterConfig).toMatchObject({
      allowCustomInput: true,
    });
  });
});

describe("RequirementCollector — optional fields (issue #1259)", () => {
  it("flags a VALUE requirement optional when its only occurrence is flagged", async () => {
    const rc = new RequirementCollector(makeApp(), makePlugin());
    await rc.scanString("{{VALUE:note|optional}}");

    expect(rc.requirements.get("note")?.optional).toBe(true);
  });

  it("applies the AND rule across VALUE occurrences", async () => {
    const rc = new RequirementCollector(makeApp(), makePlugin());
    await rc.scanString("{{VALUE:note|optional}} and {{VALUE:note}}");

    expect(rc.requirements.get("note")?.optional).toBe(false);
  });

  it("collects optional VDATE requirements via the textual scan", async () => {
    const rc = new RequirementCollector(makeApp(), makePlugin());
    await rc.scanString("Due: {{VDATE:due,YYYY-MM-DD|optional}}");

    expect(rc.requirements.get("due")).toMatchObject({
      type: "date",
      dateFormat: "YYYY-MM-DD",
      optional: true,
    });
  });

  it("keeps the VDATE default while reading the flag", async () => {
    const rc = new RequirementCollector(makeApp(), makePlugin());
    await rc.scanString("{{VDATE:due,YYYY-MM-DD|tomorrow|optional}}");

    expect(rc.requirements.get("due")).toMatchObject({
      defaultValue: "tomorrow",
      optional: true,
    });
  });

  it("applies the AND rule across VDATE occurrences and scan calls", async () => {
    const rc = new RequirementCollector(makeApp(), makePlugin());
    await rc.scanString("{{VDATE:due,YYYY-MM-DD|optional}}");
    await rc.scanString("Week: {{VDATE:due,gggg-[W]WW}}");

    expect(rc.requirements.get("due")?.optional).toBe(false);
  });

  it("keeps option-list and custom tokens optional-aware", async () => {
    const rc = new RequirementCollector(makeApp(), makePlugin());
    await rc.scanString("{{VALUE:low,med,high|optional}}");

    expect(rc.requirements.get("low,med,high")).toMatchObject({
      type: "dropdown",
      optional: true,
    });
  });

  // #239: commas inside a quoted option must survive the preflight (one-page) path.
  it("collects a quoted-comma option as a single dropdown entry", async () => {
    const rc = new RequirementCollector(makeApp(), makePlugin());
    await rc.scanString('{{VALUE:"a, b",c}}');

    const dropdown = Array.from(rc.requirements.values()).find(
      (r) => r.type === "dropdown",
    );
    expect(dropdown?.options).toEqual(["a, b", "c"]);
  });

  it("collects quoted-comma text labels aligned with their items", async () => {
    const rc = new RequirementCollector(makeApp(), makePlugin());
    await rc.scanString('{{VALUE:high,"a, b"|text:"High, urgent","A or B"}}');

    const dropdown = Array.from(rc.requirements.values()).find(
      (r) => r.type === "dropdown",
    );
    expect(dropdown?.options).toEqual(["high", "a, b"]);
    expect(dropdown?.displayOptions).toEqual(["High, urgent", "A or B"]);
  });

  it("a single quoted option records a text field, not a dropdown (preflight == runtime)", async () => {
    const rc = new RequirementCollector(makeApp(), makePlugin());
    await rc.scanString('{{VALUE:"a, b"}}');

    expect(rc.requirements.get('"a, b"')?.type).toBe("text");
  });

  it("preserves a quoted-comma default when a reuse precedes the option-list definition", async () => {
    const rc = new RequirementCollector(makeApp(), makePlugin());
    // Option-less reuse recorded first, then the named definition upgrades it to
    // a dropdown — the quoted default must unwrap to match an unquoted option.
    await rc.scanString(
      '{{VALUE:category|default:"a, b"}} {{VALUE:c,"a, b"|name:category}}',
    );

    expect(rc.requirements.get("category")).toMatchObject({
      type: "dropdown",
      options: ["c", "a, b"],
      defaultValue: "a, b",
    });
  });
});

describe("RequirementCollector property types (#757)", () => {
  const run = async (template: string) => {
    const rc = new RequirementCollector(makeApp(), makePlugin());
    await rc.scanString(template);
    return Object.fromEntries(
      Array.from(rc.requirements.values()).map((r) => [r.id, r]),
    );
  };

  it("maps |type:number to a number field", async () => {
    const byId = await run("{{VALUE:rating|type:number}}");
    expect(byId["rating"].type).toBe("number");
  });

  it("maps |type:checkbox to a true/false dropdown", async () => {
    const byId = await run("{{VALUE:done|type:checkbox}}");
    expect(byId["done"].type).toBe("dropdown");
    expect(byId["done"].options).toEqual(["true", "false"]);
  });

  it("maps |multi to a multi-select suggester", async () => {
    const byId = await run("{{VALUE:a,b,c|multi}}");
    const req = byId["a,b,c"];
    expect(req.type).toBe("suggester");
    expect(req.suggesterConfig?.multiSelect).toBe(true);
    expect(req.multiEmit).toBe("text");
  });

  it("carries |multi:linklist and |multi|custom config", async () => {
    const link = await run("{{VALUE:a,b|multi:linklist}}");
    expect(link["a,b"].multiEmit).toBe("linklist");
    const custom = await run("{{VALUE:a,b|multi|custom}}");
    expect(custom["a,b"].suggesterConfig).toMatchObject({
      multiSelect: true,
      allowCustomInput: true,
    });
  });
});
