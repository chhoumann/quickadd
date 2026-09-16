import { StubFormatter as FormatterStub } from "../../tests/helpers/formatters/stubFormatter";
import { describe, expect, it } from "vitest";
import type { Formatter } from "./formatter";

type Behavior = Parameters<Formatter["setLinkToCurrentFileBehavior"]>[0];

class StubFormatter extends FormatterStub {

  private filename: string | null = null;

  protected getCurrentFileName(): string | null {
    return this.filename;
  }

  public setFilename(filename: string | null) {
    this.filename = filename;
  }

  public async process(input: string): Promise<string> {
    return await this.replaceCurrentFileNameInString(input);
  }

  public setBehavior(behavior: Behavior) {
    this.setLinkToCurrentFileBehavior(behavior);
  }
}

describe("Formatter filename of current file behavior", () => {
  it("throws when required and no active file", async () => {
    const formatter = new StubFormatter();
    formatter.setFilename(null);
    await expect(formatter.process("{{FILENAMECURRENT}}"))
      .rejects.toThrow("Unable to get current file name");
  });

  it("silently strips placeholder when optional and no active file", async () => {
    const formatter = new StubFormatter();
    formatter.setBehavior("optional");
    formatter.setFilename(null);
    await expect(formatter.process("Before {{FILENAMECURRENT}} after"))
      .resolves.toBe("Before  after");
  });

  it.each([
	{ name: "replaces placeholder when active file available", filename: "My Note", input: "Filename: {{FILENAMECURRENT}}", expected: "Filename: My Note" },
	{ name: "handles case-insensitive replacement", filename: "Current File", input: "Name: {{filenamecurrent}}", expected: "Name: Current File" },
	{ name: "replaces multiple occurrences", filename: "Document", input: "{{FILENAMECURRENT}} - Copy of {{FILENAMECURRENT}}", expected: "Document - Copy of Document" },
  ])("$name", async ({ filename, input, expected }) => {
    const formatter = new StubFormatter();
    formatter.setBehavior("optional");
    formatter.setFilename(filename);
    await expect(formatter.process(input))
      .resolves.toBe(expected);
  });
});
