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

describe("parseListInput - Obsidian syntax", () => {
  it("preserves wiki-links with commas as single items", () => {
    const result = parseListInput("[[test, a]], [[foo]]", listHint);
    expect(result.items).toEqual(["[[test, a]]", "[[foo]]"]);
  });

  it("handles wiki-links mixed with plain text", () => {
    const result = parseListInput("[[note, part 2]], regular item, [[another, one]]", listHint);
    expect(result.items).toEqual(["[[note, part 2]]", "regular item", "[[another, one]]"]);
  });

  it("handles nested brackets correctly", () => {
    const result = parseListInput("[[outer [[inner, test]]]], plain", listHint);
    expect(result.items).toEqual(["[[outer [[inner, test]]]]", "plain"]);
  });

  it("handles wiki-links with aliases containing commas", () => {
    const result = parseListInput("[[file|display, text]], [[other]]", listHint);
    expect(result.items).toEqual(["[[file|display, text]]", "[[other]]"]);
  });

  it("handles single wiki-link with comma", () => {
    const result = parseListInput("[[test, a]]", listHint);
    expect(result.items).toEqual(["[[test, a]]"]);
  });

  it("still splits normal comma-separated values", () => {
    const result = parseListInput("alpha, beta, gamma", listHint);
    expect(result.items).toEqual(["alpha", "beta", "gamma"]);
  });

  it("respects bracket awareness with csv strategy", () => {
    const result = parseListInput("[[a, b]], c", { strategy: "csv" });
    expect(result.items).toEqual(["[[a, b]]", "c"]);
  });

  it("filters empty items with bracket syntax", () => {
    const result = parseListInput("[[test, a]], , [[foo]]", listHint);
    expect(result.items).toEqual(["[[test, a]]", "[[foo]]"]);
  });
});

describe("createListVariable", () => {
  it("overrides toString with friendly join", () => {
    const list = createListVariable(["a", "b"]);
    expect(Array.isArray(list)).toBe(true);
    expect(list.toString()).toBe("a, b");
  });
});
