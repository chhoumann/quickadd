import { describe, expect, it } from "vitest";
import { Formatter } from "./formatter";

type Behavior = Parameters<Formatter["setLinkToCurrentFileBehavior"]>[0];

class StubFormatter extends Formatter {
  constructor() {
    super();
  }

  private filename: string | null = null;

  protected async format(input: string): Promise<string> {
    return input;
  }

  protected getCurrentFileLink(): string | null {
    return null;
  }

  protected getCurrentFileName(): string | null {
    return this.filename;
  }

  protected async promptForValue(): Promise<string> {
    return "";
  }

  protected async promptForMathValue(): Promise<string> {
    return "";
  }

  protected getVariableValue(): string {
    return "";
  }

  protected async suggestForValue(): Promise<string> {
    return "";
  }

  protected async suggestForField(): Promise<string> {
    return "";
  }

  protected async getMacroValue(): Promise<string> {
    return "";
  }

  protected async promptForVariable(): Promise<string> {
    return "";
  }

  protected async getTemplateContent(): Promise<string> {
    return "";
  }

  protected async getSelectedText(): Promise<string> {
    return "";
  }

  protected async getClipboardContent(): Promise<string> {
    return "";
  }

  protected isTemplatePropertyTypesEnabled(): boolean {
    return false;
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

  it("replaces placeholder when active file available", async () => {
    const formatter = new StubFormatter();
    formatter.setBehavior("optional");
    formatter.setFilename("My Note");
    await expect(formatter.process("Filename: {{FILENAMECURRENT}}"))
      .resolves.toBe("Filename: My Note");
  });

  it("handles case-insensitive replacement", async () => {
    const formatter = new StubFormatter();
    formatter.setBehavior("optional");
    formatter.setFilename("Current File");
    await expect(formatter.process("Name: {{filenamecurrent}}"))
      .resolves.toBe("Name: Current File");
  });

  it("replaces multiple occurrences", async () => {
    const formatter = new StubFormatter();
    formatter.setBehavior("optional");
    formatter.setFilename("Document");
    await expect(formatter.process("{{FILENAMECURRENT}} - Copy of {{FILENAMECURRENT}}"))
      .resolves.toBe("Document - Copy of Document");
  });
});
