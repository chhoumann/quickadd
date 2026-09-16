import { createTFile, createMockApp } from "../../tests/helpers/formatters/captureFixtures";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../utilityObsidian", async () => (await import("../../tests/helpers/formatters/mocks")).utilityObsidianMock());

vi.mock("../gui/InputPrompt", () => ({
  __esModule: true,
  default: class {
    factory() {
      return { Prompt: vi.fn().mockResolvedValue("") } as any;
    }
  },
}));

vi.mock("../gui/InputSuggester/inputSuggester", async () => (await import("../../tests/helpers/formatters/mocks")).inputSuggesterMock());

vi.mock("../gui/GenericSuggester/genericSuggester", async () => (await import("../../tests/helpers/formatters/mocks")).genericSuggesterMock());

vi.mock("../gui/VDateInputPrompt/VDateInputPrompt", async () => (await import("../../tests/helpers/formatters/mocks")).VDateInputPromptMock());

vi.mock("../utils/errorUtils", () => ({
  __esModule: true,
  reportError: vi.fn(),
}));

vi.mock("../gui/MathModal", async () => (await import("../../tests/helpers/formatters/mocks")).MathModalMock());

vi.mock("../engine/SingleInlineScriptEngine", () => ({
  __esModule: true,
  SingleInlineScriptEngine: class {
    public params = { variables: {} as Record<string, unknown> };
    constructor() {}
    async runAndGetOutput() {
      return "";
    }
  },
}));

vi.mock("../engine/SingleMacroEngine", async () => (await import("../../tests/helpers/formatters/mocks")).SingleMacroEngineMockWithConstructor());

vi.mock("../engine/SingleTemplateEngine", async () => (await import("../../tests/helpers/formatters/mocks")).SingleTemplateEngineMockWithConstructor());

vi.mock("obsidian-dataview", async () => (await import("../../tests/helpers/formatters/mocks")).obsidiandataviewMock());

import { CaptureChoiceFormatter } from "./captureChoiceFormatter";

const createFormatter = () => {
  const app = createMockApp();
  const plugin = {
    settings: {
      enableTemplatePropertyTypes: false,
      globalVariables: {},
      showCaptureNotification: false,
    },
  } as any;
  return new CaptureChoiceFormatter(app, plugin);
};

describe("CaptureChoiceFormatter {{FOLDER}} resolves to the destination folder", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    (global as any).navigator = {
      clipboard: { readText: vi.fn().mockResolvedValue("") },
    };
  });

  it("derives {{FOLDER}} from a destination source path (file not yet created)", async () => {
    const formatter = createFormatter();
    formatter.setDestinationSourcePath("Journal/2024/Inbox.md");

    const result = await formatter.formatContentOnly("Filed under {{FOLDER}}");

    expect(result).toBe("Filed under Journal/2024");
  });

  it("derives {{FOLDER|name}} from an existing destination file", async () => {
    const formatter = createFormatter();
    formatter.setDestinationFile(createTFile("Areas/Health/Log.md"));

    const result = await formatter.formatContentOnly("{{FOLDER|name}} log");

    expect(result).toBe("Health log");
  });

  it("resolves {{FOLDER}} to empty for a destination at the vault root", async () => {
    const formatter = createFormatter();
    formatter.setDestinationSourcePath("Inbox.md");

    const result = await formatter.formatContentOnly("[{{FOLDER}}]note");

    expect(result).toBe("[]note");
  });
});
