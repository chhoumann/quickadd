import { describe, expect, it } from "vitest";
import { Formatter } from "./formatter";

type Behavior = Parameters<Formatter["setLinkToCurrentFileBehavior"]>[0];

class StubFormatter extends Formatter {
  private link: string | null = null;

  protected async format(input: string): Promise<string> {
    return input;
  }

  protected getCurrentFileLink(): string | null {
    return this.link;
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

  protected isYamlStructuredVariablesEnabled(): boolean {
    return false; // Test formatter doesn't need structured YAML variable handling
  }

  public setLink(link: string | null) {
    this.link = link;
  }

  public async process(input: string): Promise<string> {
    return await this.replaceLinkToCurrentFileInString(input);
  }

  public setBehavior(behavior: Behavior) {
    this.setLinkToCurrentFileBehavior(behavior);
  }
}

describe("Formatter link to current file behavior", () => {
  it("throws when required and no active file", async () => {
    const formatter = new StubFormatter();
    formatter.setLink(null);
    await expect(formatter.process("{{LINKCURRENT}}"))
      .rejects.toThrow("Unable to get current file path");
  });

  it("silently strips placeholder when optional and no active file", async () => {
    const formatter = new StubFormatter();
    formatter.setBehavior("optional");
    formatter.setLink(null);
    await expect(formatter.process("Before {{LINKCURRENT}} after"))
      .resolves.toBe("Before  after");
  });

  it("replaces placeholder when active file available", async () => {
    const formatter = new StubFormatter();
    formatter.setBehavior("optional");
    formatter.setLink("[[Note]]");
    await expect(formatter.process("Link: {{LINKCURRENT}}"))
      .resolves.toBe("Link: [[Note]]");
  });
});
