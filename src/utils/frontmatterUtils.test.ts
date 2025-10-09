import { describe, expect, it } from "vitest";

import { getFrontmatterEndLine } from "./frontmatterUtils";

describe("getFrontmatterEndLine", () => {
  it("returns null when no frontmatter is present", () => {
    const content = "# Note\nBody";
    expect(getFrontmatterEndLine(content)).toBeNull();
  });

  it("finds the closing delimiter for standard frontmatter", () => {
    const content = [
      "---",
      "tags:",
      "  - test",
      "---",
      "Body",
    ].join("\n");

    expect(getFrontmatterEndLine(content)).toBe(3);
  });

  it("handles CRLF line endings", () => {
    const content = "---\r\ntitle: Test\r\n---\r\nBody";
    expect(getFrontmatterEndLine(content)).toBe(2);
  });

  it("returns null when closing delimiter is missing", () => {
    const content = "---\ntitle: Test\nBody";
    expect(getFrontmatterEndLine(content)).toBeNull();
  });

  it("supports YAML end marker ellipsis", () => {
    const content = "---\ntitle: Test\n...\nBody";
    expect(getFrontmatterEndLine(content)).toBe(2);
  });
});
