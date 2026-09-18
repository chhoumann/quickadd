import { beforeEach, describe, expect, it, vi } from "vitest";
import type { App, TFile } from "obsidian";

/**
 * Guards the sink-context gate for prompt image paste (issue #1484): value
 * prompts opened while formatting note CONTENT carry `imagePaste` in their
 * options; prompts opened from PATH passes (file name, folder, capture
 * destination, location targets) never do - an embed link in a path would
 * corrupt it.
 */

const mocks = vi.hoisted(() => ({
	inputPromptPrompt: vi.fn(),
	inputPromptPromptWithContext: vi.fn(),
	inputPromptFactory: vi.fn(),
}));

vi.mock("obsidian", () => ({
	MarkdownView: class {},
	normalizePath: (path: string) =>
		path.replace(/\\/g, "/").replace(/\/+/g, "/"),
}));

vi.mock("../utilityObsidian", async () => (await import("../../tests/helpers/formatters/mocks")).utilityObsidianMock());

vi.mock("../gui/InputPrompt", () => ({
	__esModule: true,
	default: class {
		factory(inputTypeOverride?: string) {
			mocks.inputPromptFactory(inputTypeOverride);
			return {
				Prompt: mocks.inputPromptPrompt,
				PromptWithContext: mocks.inputPromptPromptWithContext,
			};
		}
	},
}));

vi.mock("src/gui/GenericInputPrompt/GenericInputPrompt", () => ({
	__esModule: true,
	default: { PromptWithContext: vi.fn().mockResolvedValue("") },
}));

vi.mock("src/gui/InputSuggester/inputSuggester", async () => (await import("../../tests/helpers/formatters/mocks")).genericSuggesterMock());

vi.mock("src/gui/MultiSuggester/multiSuggester", () => ({
	__esModule: true,
	default: { Suggest: vi.fn().mockResolvedValue([]) },
}));

vi.mock("src/gui/VDateInputPrompt/VDateInputPrompt", async () => (await import("../../tests/helpers/formatters/mocks")).VDateInputPromptMock());

vi.mock("../gui/GenericSuggester/genericSuggester", async () => (await import("../../tests/helpers/formatters/mocks")).genericSuggesterMock());

vi.mock("../gui/MathModal", async () => (await import("../../tests/helpers/formatters/mocks")).MathModalMock());

vi.mock("../engine/SingleInlineScriptEngine", async () => (await import("../../tests/helpers/formatters/mocks")).SingleInlineScriptEngineMock());

vi.mock("../engine/SingleMacroEngine", () => ({
	__esModule: true,
	SingleMacroEngine: class {
		async runAndGetOutput() {
			return "";
		}
		getVariables() {
			return new Map();
		}
	},
}));

vi.mock("../engine/SingleTemplateEngine", () => ({
	__esModule: true,
	SingleTemplateEngine: class {
		async run() {
			return "";
		}
		getAndClearTemplatePropertyVars() {
			return new Map();
		}
		setLinkToCurrentFileBehavior() {}
		setTargetFolderPath() {}
		setPromptRunContext() {}
	},
}));

vi.mock("obsidian-dataview", async () => (await import("../../tests/helpers/formatters/mocks")).obsidiandataviewMock());

vi.mock("../logger/logManager", async () => (await import("../../tests/helpers/formatters/mocks")).logManagerMock());

import { CompleteFormatter } from "./completeFormatter";
import { CaptureChoiceFormatter } from "./captureChoiceFormatter";

function createMockApp(): App {
	return {
		workspace: {
			getActiveFile: vi.fn().mockReturnValue(null),
			getActiveViewOfType: vi.fn().mockReturnValue(null),
		},
		metadataCache: { getFileCache: vi.fn().mockReturnValue(null) },
		fileManager: {
			generateMarkdownLink: vi.fn((file: TFile) => `[[${file.path}]]`),
			getAvailablePathForAttachment: vi.fn(async () => "Assets/x.png"),
		},
		vault: {
			adapter: { exists: vi.fn() },
			cachedRead: vi.fn(),
		},
	} as unknown as App;
}

const plugin = {
	settings: {
		enableTemplatePropertyTypes: false,
		globalVariables: {},
		inputPrompt: "single-line",
	},
} as never;

function lastPromptOptions(mock: ReturnType<typeof vi.fn>) {
	const call = mock.mock.calls.at(-1);
	if (!call) throw new Error("prompt was not called");
	return call[5];
}

beforeEach(() => {
	mocks.inputPromptPrompt.mockReset().mockResolvedValue("typed");
	mocks.inputPromptPromptWithContext.mockReset().mockResolvedValue("typed");
	mocks.inputPromptFactory.mockReset();
	Object.defineProperty(globalThis, "navigator", {
		value: { clipboard: { readText: vi.fn().mockResolvedValue("") } },
		configurable: true,
	});
});

describe("image paste sink-context gating", () => {
	it("offers image paste for {{VALUE}} prompts during content formatting", async () => {
		const f = new CompleteFormatter(createMockApp(), plugin);

		await f.formatFileContent("{{VALUE}}");

		expect(lastPromptOptions(mocks.inputPromptPrompt)).toEqual({
			optional: undefined,
			numeric: undefined,
			slider: undefined,
			imagePaste: { sourcePath: "" },
			allowPeek: true,
		});
	});

	it("offers image paste for named {{VALUE:x}} prompts during content formatting", async () => {
		const f = new CompleteFormatter(createMockApp(), plugin);

		await f.formatFileContent("{{VALUE:note body}}");

		expect(lastPromptOptions(mocks.inputPromptPrompt)).toMatchObject({
			imagePaste: { sourcePath: "" },
		});
	});

	it("never offers image paste in file name prompts", async () => {
		const f = new CompleteFormatter(createMockApp(), plugin);

		await f.formatFileName("{{VALUE}}");

		expect(lastPromptOptions(mocks.inputPromptPrompt)?.imagePaste).toBeUndefined();
	});

	it("never offers image paste in folder path prompts", async () => {
		const f = new CompleteFormatter(createMockApp(), plugin);

		await f.formatFolderPath("{{VALUE:folder}}");

		expect(lastPromptOptions(mocks.inputPromptPrompt)?.imagePaste).toBeUndefined();
	});

	it("never offers image paste in template path prompts", async () => {
		const f = new CompleteFormatter(createMockApp(), plugin);

		await f.formatTemplateFilePath("Templates/{{VALUE:kind}}.md");

		expect(lastPromptOptions(mocks.inputPromptPrompt)?.imagePaste).toBeUndefined();
	});

	it("restores the path-context default after content formatting", async () => {
		const f = new CompleteFormatter(createMockApp(), plugin);

		await f.formatFileContent("{{VALUE:first}}");
		await f.formatFolderPath("{{VALUE:second}}");

		expect(lastPromptOptions(mocks.inputPromptPrompt)?.imagePaste).toBeUndefined();
	});

	it("keeps number/slider prompts free of image paste even in content", async () => {
		const f = new CompleteFormatter(createMockApp(), plugin);

		await f.formatFileContent("{{VALUE:n|type:number}}");

		const options = lastPromptOptions(mocks.inputPromptPrompt);
		expect(options?.imagePaste).toBeUndefined();
	});

	it("passes the capture destination as the paste sourcePath", async () => {
		const f = new CaptureChoiceFormatter(createMockApp(), plugin);
		f.setDestinationSourcePath("Journal/2026-07-06.md");

		await f.formatContentOnly("{{VALUE}}");

		// Capture value prompts route through PromptWithContext because a
		// link source path exists; options stay the 6th argument.
		const options =
			mocks.inputPromptPromptWithContext.mock.calls.at(-1)?.[6] ??
			lastPromptOptions(mocks.inputPromptPrompt);
		expect(options?.imagePaste).toEqual({
			sourcePath: "Journal/2026-07-06.md",
		});
	});
});
