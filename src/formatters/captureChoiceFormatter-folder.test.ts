import { beforeEach, describe, expect, it, vi } from "vitest";
import type { App, TFile } from "obsidian";

vi.mock("../utilityObsidian", () => ({
  templaterParseTemplate: vi.fn().mockResolvedValue(null),
}));

vi.mock("../gui/InputPrompt", () => ({
  __esModule: true,
  default: class {
    factory() {
      return { Prompt: vi.fn().mockResolvedValue("") } as any;
    }
  },
}));

vi.mock("../gui/InputSuggester/inputSuggester", () => ({
  __esModule: true,
  default: class {
    constructor() {}
  },
}));

vi.mock("../gui/GenericSuggester/genericSuggester", () => ({
  __esModule: true,
  default: { Suggest: vi.fn().mockResolvedValue("") },
}));

vi.mock("../gui/VDateInputPrompt/VDateInputPrompt", () => ({
  __esModule: true,
  default: { Prompt: vi.fn().mockResolvedValue("") },
}));

vi.mock("../utils/errorUtils", () => ({
  __esModule: true,
  reportError: vi.fn(),
}));

vi.mock("../gui/MathModal", () => ({
  __esModule: true,
  MathModal: { Prompt: vi.fn().mockResolvedValue("") },
}));

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

vi.mock("../engine/SingleMacroEngine", () => ({
  __esModule: true,
  SingleMacroEngine: class {
    constructor() {}
    async runAndGetOutput() {
      return "";
    }
  },
}));

vi.mock("../engine/SingleTemplateEngine", () => ({
  __esModule: true,
  SingleTemplateEngine: class {
    constructor() {}
    async run() {
      return "";
    }
    getAndClearTemplatePropertyVars() {
      return new Map();
    }
    setLinkToCurrentFileBehavior() {}
  },
}));

vi.mock("obsidian-dataview", () => ({
  __esModule: true,
  getAPI: vi.fn().mockReturnValue(null),
}));

import { CaptureChoiceFormatter } from "./captureChoiceFormatter";

const createMockApp = (): App =>
  ({
    workspace: {
      getActiveFile: vi.fn().mockReturnValue(null),
      getActiveViewOfType: vi.fn().mockReturnValue(null),
    },
    metadataCache: { getFileCache: vi.fn().mockReturnValue(null) },
    fileManager: {
      generateMarkdownLink: vi.fn().mockReturnValue(""),
      processFrontMatter: vi.fn(),
    },
    vault: { adapter: { exists: vi.fn() }, cachedRead: vi.fn() },
  }) as unknown as App;

const createTFile = (path: string): TFile => {
  const name = path.split("/").pop() ?? path;
  return {
    path,
    name,
    basename: name.replace(/\.(md|canvas)$/i, ""),
    extension: path.endsWith(".md") ? "md" : "canvas",
  } as unknown as TFile;
};

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
