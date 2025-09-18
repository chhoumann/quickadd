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
