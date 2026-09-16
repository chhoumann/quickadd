import { StubFormatter as FormatterStub } from "../../tests/helpers/formatters/stubFormatter";
import { describe, expect, it } from "vitest";

class StubFormatter extends FormatterStub {

  public process(input: string): string {
    return this.replaceTargetFolderInString(input);
  }
}

describe("Formatter {{FOLDER}} token", () => {
  it("resolves {{FOLDER}} to the full target folder path", () => {
    const formatter = new StubFormatter();
    formatter.setTargetFolderPath("Projects/Acme");
    expect(formatter.process("Filed under {{FOLDER}}")).toBe(
      "Filed under Projects/Acme",
    );
  });

  it("resolves {{FOLDER|name}} to the leaf folder segment", () => {
    const formatter = new StubFormatter();
    formatter.setTargetFolderPath("Projects/Acme");
    expect(formatter.process("{{FOLDER|name}} - note")).toBe("Acme - note");
  });

  it("resolves {{FOLDER}} to an empty string when no target folder is set", () => {
    const formatter = new StubFormatter();
    expect(formatter.process("a/{{FOLDER}}b")).toBe("a/b");
  });

  it("treats a single-segment folder name as both full path and leaf", () => {
    const formatter = new StubFormatter();
    formatter.setTargetFolderPath("Meetings");
    expect(formatter.process("{{FOLDER}}|{{FOLDER|name}}")).toBe(
      "Meetings|Meetings",
    );
  });

  it("normalizes the vault root '/' to an empty string", () => {
    const formatter = new StubFormatter();
    formatter.setTargetFolderPath("/");
    expect(formatter.process("[{{FOLDER}}]")).toBe("[]");
  });

  it("strips leading and trailing slashes from the target folder", () => {
    const formatter = new StubFormatter();
    formatter.setTargetFolderPath("/A/B/");
    expect(formatter.process("{{FOLDER}}")).toBe("A/B");
    expect(formatter.process("{{FOLDER|name}}")).toBe("B");
  });

  it("is case-insensitive for the token and the modifier", () => {
    const formatter = new StubFormatter();
    formatter.setTargetFolderPath("Projects/Acme");
    expect(formatter.process("{{folder}} / {{FOLDER|NAME}}")).toBe(
      "Projects/Acme / Acme",
    );
  });

  it("replaces multiple occurrences in one pass", () => {
    const formatter = new StubFormatter();
    formatter.setTargetFolderPath("Inbox");
    expect(formatter.process("{{FOLDER}}-{{FOLDER}}")).toBe("Inbox-Inbox");
  });

  it("treats '$' in a folder name literally (no regex re-expansion)", () => {
    const formatter = new StubFormatter();
    formatter.setTargetFolderPath("Cash$Money");
    expect(formatter.process("{{FOLDER}}")).toBe("Cash$Money");
  });

  it("clears the target folder when set to null", () => {
    const formatter = new StubFormatter();
    formatter.setTargetFolderPath("Projects");
    formatter.setTargetFolderPath(null);
    expect(formatter.process("x{{FOLDER}}y")).toBe("xy");
  });
});
