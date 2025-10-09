import { describe, expect, it } from "vitest";

import { createListVariable, parseListInput } from "./listInputParser";

const listHint = { strategy: "auto" } as const;

describe("parseListInput", () => {
  it("splits comma separated values", () => {
    const result = parseListInput("tag1, tag2, tag3", listHint);
    expect(result.items).toEqual(["tag1", "tag2", "tag3"]);
  });

  it("handles newline separated values", () => {
    const result = parseListInput("alpha\nbeta\ngamma", { strategy: "newline" });
    expect(result.items).toEqual(["alpha", "beta", "gamma"]);
  });

  it("handles bullet lists", () => {
    const result = parseListInput("- item one\n- item two\n- item three", listHint);
    expect(result.items).toEqual(["item one", "item two", "item three"]);
  });

  it("returns original array when provided", () => {
    const result = parseListInput(["one", "two"], listHint);
    expect(result.items).toEqual(["one", "two"]);
  });

  it("falls back to single item list", () => {
    const result = parseListInput("solo", listHint);
    expect(result.items).toEqual(["solo"]);
  });

  it("parses json arrays", () => {
    const result = parseListInput('["one", "two"]', listHint);
    expect(result.items).toEqual(["one", "two"]);
  });
});

describe("createListVariable", () => {
  it("overrides toString with friendly join", () => {
    const list = createListVariable(["a", "b"]);
    expect(Array.isArray(list)).toBe(true);
    expect(list.toString()).toBe("a, b");
  });
});
