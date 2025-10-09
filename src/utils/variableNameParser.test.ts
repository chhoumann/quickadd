import { describe, expect, it } from "vitest";

import { parseVariableNameSpec } from "./variableNameParser";

describe("parseVariableNameSpec", () => {
  it("parses a basic variable without hints", () => {
    const result = parseVariableNameSpec("project");
    expect(result.canonical).toBe("project");
    expect(result.base).toBe("project");
    expect(result.isOptionList).toBe(false);
    expect(result.hints).toHaveLength(0);
  });

  it("detects option list tokens", () => {
    const result = parseVariableNameSpec("low,medium,high");
    expect(result.isOptionList).toBe(true);
    expect(result.suggestions).toEqual(["low", "medium", "high"]);
  });

  it("parses @list hint without options", () => {
    const result = parseVariableNameSpec("tags@list");
    expect(result.base).toBe("tags");
    expect(result.hints).toHaveLength(1);
    const hint = result.hints[0];
    if (hint.kind !== "list") throw new Error("expected list hint");
    expect(hint.options.strategy).toBe("auto");
  });

  it("parses @list hint with csv strategy", () => {
    const result = parseVariableNameSpec("tags@list(csv)");
    const hint = result.hints[0];
    if (hint.kind !== "list") throw new Error("expected list hint");
    expect(hint.options.strategy).toBe("csv");
  });

  it("parses @list hint with delimiter override", () => {
    const result = parseVariableNameSpec("keywords@list(delimiter=;) ");
    const hint = result.hints[0];
    if (hint.kind !== "list") throw new Error("expected list hint");
    expect(hint.options.delimiter).toBe(";");
  });
});
