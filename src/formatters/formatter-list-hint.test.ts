import { describe, expect, it, beforeEach } from "vitest";

import { Formatter } from "./formatter";

class ListHintFormatterTest extends Formatter {
  private promptResponses = new Map<string, string>();

  protected async format(input: string): Promise<string> {
    let output = input;
    output = await this.replaceVariableInString(output);
    return output;
  }

  protected getVariableValue(variableName: string): string {
    const value = this.getResolvedVariableValue(variableName);
    if (value === undefined || value === null) return "";
    return typeof value === "string" ? value : value.toString();
  }

  protected async promptForVariable(header?: string): Promise<string> {
    if (!header) return "";
    return this.promptResponses.get(header) ?? "";
  }

  protected suggestForValue(suggestedValues: string[]): Promise<string> | string {
    return suggestedValues[0] ?? "";
  }

  protected suggestForField(): Promise<string> {
    return Promise.resolve("");
  }

  protected promptForMathValue(): Promise<string> {
    return Promise.resolve("");
  }

  protected getMacroValue(): Promise<string> | string {
    return "";
  }

  protected async promptForValue(): Promise<string> {
    return "";
  }

  protected getCurrentFileLink(): string | null {
    return null;
  }

  protected getTemplateContent(): Promise<string> {
    return Promise.resolve("");
  }

  protected getSelectedText(): Promise<string> {
    return Promise.resolve("");
  }

  protected getClipboardContent(): Promise<string> {
    return Promise.resolve("");
  }

  protected isTemplatePropertyTypesEnabled(): boolean {
    return true;
  }

  public setPromptResponse(name: string, value: string): void {
    this.promptResponses.set(name, value);
  }

  public seedVariable(name: string, value: unknown): void {
    this.variables.set(name, value);
  }

  public async formatTemplate(input: string): Promise<string> {
    return this.format(input);
  }
}

describe("Formatter @list hint", () => {
  let formatter: ListHintFormatterTest;

  beforeEach(() => {
    formatter = new ListHintFormatterTest();
  });

  it("converts comma separated prompt input into YAML list variables", async () => {
    formatter.setPromptResponse("tags", "alpha, beta, gamma");

    const result = await formatter.formatTemplate("---\ntags: {{VALUE:tags@list}}\n---\n");
    expect(result).toContain("alpha, beta, gamma");

    const vars = formatter.getAndClearTemplatePropertyVars();
    expect(vars.get("tags")).toEqual(["alpha", "beta", "gamma"]);
  });

  it("normalizes bullet list input", async () => {
    formatter.setPromptResponse("tasks", "- item one\n- item two\n- item three");

    await formatter.formatTemplate("---\ntasks: {{VALUE:tasks@list}}\n---\n");

    const vars = formatter.getAndClearTemplatePropertyVars();
    expect(vars.get("tasks")).toEqual(["item one", "item two", "item three"]);
  });

  it("respects delimiter overrides", async () => {
    formatter.setPromptResponse("keywords", "one;two;three");

    await formatter.formatTemplate("---\nkeywords: {{VALUE:keywords@list(delimiter=;)}}\n---\n");

    const vars = formatter.getAndClearTemplatePropertyVars();
    expect(vars.get("keywords")).toEqual(["one", "two", "three"]);
  });

  it("converts pre-seeded base variables without prompting", async () => {
    formatter.seedVariable("projects", "alpha, beta");

    const output = await formatter.formatTemplate("---\nprojects: {{VALUE:projects@list}}\n---\n");
    expect(output).toContain("alpha, beta");

    const vars = formatter.getAndClearTemplatePropertyVars();
    expect(vars.get("projects")).toEqual(["alpha", "beta"]);
  });
});
