import { vi } from "vitest";

export const utilityObsidianMock = () => ({
	templaterParseTemplate: vi.fn().mockResolvedValue(null),
});

export const InputPromptMock = () => ({
	__esModule: true,
	default: class {
		factory() {
			return {
				Prompt: vi.fn().mockResolvedValue(""),
				PromptWithContext: vi.fn().mockResolvedValue(""),
			};
		}
	},
});

export const inputSuggesterMock = () => ({
	__esModule: true,
	default: class {
		constructor() {}
	},
});

export const genericSuggesterMock = () => ({
	__esModule: true,
	default: { Suggest: vi.fn().mockResolvedValue("") },
});

export const VDateInputPromptMock = () => ({
	__esModule: true,
	default: { Prompt: vi.fn().mockResolvedValue("") },
});

export const errorUtilsMock = () => ({
	__esModule: true,
	reportError: vi.fn(),
	isCancellationError: vi.fn().mockReturnValue(false),
});

export const MathModalMock = () => ({
	__esModule: true,
	MathModal: { Prompt: vi.fn().mockResolvedValue("") },
});

export const SingleInlineScriptEngineMock = () => ({
	__esModule: true,
	SingleInlineScriptEngine: class {
		public params = { variables: {} as Record<string, unknown> };
		async runAndGetOutput() {
			return "";
		}
	},
});

export const SingleMacroEngineMock = () => ({
	__esModule: true,
	SingleMacroEngine: class {
		async runAndGetOutput() {
			return "";
		}
	},
});

export const SingleTemplateEngineMock = () => ({
	__esModule: true,
	SingleTemplateEngine: class {
		async run() {
			return "";
		}
		getAndClearTemplatePropertyVars() {
			return new Map();
		}
		setLinkToCurrentFileBehavior() {}
	},
});

export const obsidiandataviewMock = () => ({
	__esModule: true,
	getAPI: vi.fn().mockReturnValue(null),
});

export const mainMock = () => ({
	__esModule: true,
	default: class QuickAdd {
		static instance = {
			settings: { inputPrompt: "single-line" },
			app: {
				workspace: { getActiveViewOfType: vi.fn().mockReturnValue(null) },
			},
		};
		settings = QuickAdd.instance.settings;
		app = QuickAdd.instance.app;
	},
});

export const logManagerMock = () => ({
	log: {
		logError: vi.fn(),
		logWarning: vi.fn(),
		logMessage: vi.fn(),
	},
});

export const SingleMacroEngineMockWithConstructor = () => ({
  __esModule: true,
  SingleMacroEngine: class {
    constructor() {}
    async runAndGetOutput() {
      return "";
    }
  },
});

export const SingleTemplateEngineMockWithConstructor = () => ({
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
});

export const obsidianMock = () => {
	class MarkdownView {}
	return { MarkdownView };
};
