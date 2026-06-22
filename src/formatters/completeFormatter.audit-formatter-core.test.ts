import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Regression tests for the formatter-core audit fixes that live in
 * src/formatters/completeFormatter.ts:
 *  - format-core-title-token / format-file-title-token: a {{title}} injected by a
 *    global snippet or a {{VALUE}} value must throw post-format() in
 *    formatFileName / formatFolderPath (not leak the literal token into a path).
 *  - value-syntax-type-checkbox: an active selection must NOT bypass the forced
 *    true/false picker for an anonymous {{VALUE|type:checkbox}} unless the
 *    selection is itself "true"/"false".
 *  - integrations-field-filter-default: a multi-select FIELD with no vault values
 *    seeds the picker with smart defaults.
 *
 * The heavy collaborators are mocked, mirroring completeFormatter.test.ts.
 */

const mocks = vi.hoisted(() => ({
	macroRunAndGetOutput: vi.fn(),
	macroGetVariables: vi.fn(() => new Map()),
	templateRun: vi.fn(),
	inlineRunAndGetOutput: vi.fn(),
	inlineParamsVariables: {} as Record<string, unknown>,
	inputPromptPrompt: vi.fn(),
	inputPromptPromptWithContext: vi.fn(),
	inputPromptFactory: vi.fn(),
	genericInputPromptWithContext: vi.fn(),
	inputSuggesterSuggest: vi.fn(),
	genericSuggesterSuggest: vi.fn(),
	multiSuggesterSuggest: vi.fn(),
	vdatePrompt: vi.fn(),
	mathPrompt: vi.fn(),
	fieldParse: vi.fn(),
	collectProcessedDetailed: vi.fn(),
	collectRaw: vi.fn(),
	getSmartDefaults: vi.fn(() => [] as string[]),
	dateAliases: {} as Record<string, string>,
}));

vi.mock("obsidian", () => {
	class MarkdownView {}
	return { MarkdownView };
});

vi.mock("../engine/SingleMacroEngine", () => ({
	SingleMacroEngine: class {
		runAndGetOutput = mocks.macroRunAndGetOutput;
		getVariables = mocks.macroGetVariables;
	},
}));

vi.mock("../engine/SingleTemplateEngine", () => ({
	SingleTemplateEngine: class {
		run() {
			return mocks.templateRun.call(this);
		}
		setTargetFolderPath() {}
		getAndClearTemplatePropertyVars() {
			return new Map();
		}
	},
}));

vi.mock("../engine/SingleInlineScriptEngine", () => ({
	SingleInlineScriptEngine: class {
		params = { variables: mocks.inlineParamsVariables };
		runAndGetOutput = mocks.inlineRunAndGetOutput;
	},
}));

vi.mock("../gui/InputPrompt", () => ({
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
	default: { PromptWithContext: mocks.genericInputPromptWithContext },
}));

vi.mock("src/gui/InputSuggester/inputSuggester", () => ({
	default: { Suggest: mocks.inputSuggesterSuggest },
}));

vi.mock("../gui/GenericSuggester/genericSuggester", () => ({
	default: { Suggest: mocks.genericSuggesterSuggest },
}));

vi.mock("src/gui/MultiSuggester/multiSuggester", () => ({
	default: { Suggest: mocks.multiSuggesterSuggest },
}));

vi.mock("src/gui/VDateInputPrompt/VDateInputPrompt", () => ({
	default: { Prompt: mocks.vdatePrompt },
}));

vi.mock("../gui/MathModal", () => ({
	MathModal: { Prompt: mocks.mathPrompt },
}));

vi.mock("../parsers/NLDParser", () => ({
	NLDParser: { parseDate: () => null },
}));

vi.mock("../utils/FieldSuggestionParser", () => ({
	FieldSuggestionParser: { parse: mocks.fieldParse },
}));

vi.mock("../utils/FieldValueCollector", () => ({
	collectFieldValuesProcessedDetailed: mocks.collectProcessedDetailed,
	collectFieldValuesRaw: mocks.collectRaw,
	generateFieldCacheKey: (f: unknown) => JSON.stringify(f),
}));

vi.mock("../utils/FieldValueProcessor", () => ({
	FieldValueProcessor: { getSmartDefaults: mocks.getSmartDefaults },
}));

vi.mock("../settingsStore", () => ({
	settingsStore: { getState: () => ({ dateAliases: mocks.dateAliases }) },
}));

vi.mock("../logger/logManager", () => ({
	log: {
		logError: vi.fn(),
		logWarning: vi.fn(),
		logMessage: vi.fn(),
	},
}));

const { CompleteFormatter } = await import("./completeFormatter");

type FakeFile = { basename: string } | null;

function makeApp(state: {
	activeFile: FakeFile;
	selection: string | null;
	generatedLink?: string;
}) {
	return {
		workspace: {
			getActiveFile: () => state.activeFile,
			getActiveViewOfType: () =>
				state.selection === null
					? undefined
					: { editor: { getSelection: () => state.selection } },
		},
		fileManager: {
			generateMarkdownLink: () => state.generatedLink ?? "",
		},
	};
}

function makePlugin(globalVariables: Record<string, string> = {}) {
	return {
		settings: {
			globalVariables,
			enableTemplatePropertyTypes: false,
			choices: [],
			inputPrompt: "single-line",
		},
	};
}

function formatter(
	globalVariables: Record<string, string> = {},
	app: Partial<{ activeFile: FakeFile; selection: string | null }> = {},
) {
	return new CompleteFormatter(
		makeApp({
			activeFile: app.activeFile ?? null,
			selection: app.selection ?? null,
		}) as any,
		makePlugin(globalVariables) as any,
	);
}

beforeEach(() => {
	mocks.dateAliases = {};
	vi.clearAllMocks();
	mocks.macroGetVariables.mockReturnValue(new Map());
	mocks.getSmartDefaults.mockReturnValue([]);
	(globalThis as any).navigator = {
		clipboard: { readText: vi.fn().mockResolvedValue("") },
	};
});

describe("circular {{title}} re-check after format() (format-file-title-token)", () => {
	it("formatFileName throws when a global snippet expands to {{title}}", async () => {
		const f = formatter({ snip: "{{title}}" });
		await expect(
			f.formatFileName("{{GLOBAL_VAR:snip}}-note", "Value"),
		).rejects.toThrow("circular dependency");
	});

	it("formatFolderPath throws when a global snippet expands to {{title}}", async () => {
		const f = formatter({ snip: "{{title}}" });
		await expect(
			f.formatFolderPath("folder/{{GLOBAL_VAR:snip}}"),
		).rejects.toThrow("circular dependency");
	});

	it("formatFileName still throws on a raw {{title}} (unchanged)", async () => {
		const f = formatter();
		await expect(f.formatFileName("{{title}}-x", "V")).rejects.toThrow(
			"circular dependency",
		);
	});

	it("formatFileName does not false-positive on a global with no {{title}}", async () => {
		const f = formatter({ greeting: "hello" });
		await expect(
			f.formatFileName("{{GLOBAL_VAR:greeting}}-note", "V"),
		).resolves.toBe("hello-note");
	});
});

describe("anonymous {{VALUE|type:checkbox}} vs active selection (value-syntax-type-checkbox)", () => {
	it("does NOT use a non-boolean selection; falls through to the forced picker", async () => {
		mocks.genericSuggesterSuggest.mockResolvedValue("true");
		const f = formatter({}, { selection: "hello world" });

		const out = await f.formatFileContent("[{{VALUE|type:checkbox}}]");

		expect(out).toBe("[true]");
		// The forced true/false picker ran (not the raw selection).
		expect(mocks.genericSuggesterSuggest).toHaveBeenCalledTimes(1);
		const call = mocks.genericSuggesterSuggest.mock.calls[0];
		expect(call[1]).toEqual(["true", "false"]);
	});

	it("accepts a boolean selection without showing the picker", async () => {
		const f = formatter({}, { selection: "  TRUE  " });

		const out = await f.formatFileContent("[{{VALUE|type:checkbox}}]");

		expect(out).toBe("[true]");
		expect(mocks.genericSuggesterSuggest).not.toHaveBeenCalled();
	});
});

describe("multi-select FIELD seeds smart defaults when vault is empty (integrations-field-filter-default)", () => {
	it("passes smart defaults to MultiSuggester when no values exist", async () => {
		mocks.fieldParse.mockReturnValue({
			fieldName: "status",
			filters: {},
			multiSelect: true,
		});
		mocks.collectProcessedDetailed.mockResolvedValue({
			values: [],
			hasDefaultValue: false,
		});
		mocks.getSmartDefaults.mockReturnValue(["To Do", "In Progress", "Done"]);
		mocks.multiSuggesterSuggest.mockResolvedValue(["To Do"]);

		const f = formatter();
		await f.formatFileContent("{{FIELD:status|multi}}");

		expect(mocks.multiSuggesterSuggest).toHaveBeenCalledTimes(1);
		const call = mocks.multiSuggesterSuggest.mock.calls[0];
		// displayValues + values both seeded with the smart defaults.
		expect(call[1]).toEqual(["To Do", "In Progress", "Done"]);
		expect(call[2]).toEqual(["To Do", "In Progress", "Done"]);
	});

	it("still opens an empty picker when there are no smart defaults", async () => {
		mocks.fieldParse.mockReturnValue({
			fieldName: "weird",
			filters: {},
			multiSelect: true,
		});
		mocks.collectProcessedDetailed.mockResolvedValue({
			values: [],
			hasDefaultValue: false,
		});
		mocks.getSmartDefaults.mockReturnValue([]);
		mocks.multiSuggesterSuggest.mockResolvedValue([]);

		const f = formatter();
		await f.formatFileContent("{{FIELD:weird|multi}}");

		const call = mocks.multiSuggesterSuggest.mock.calls[0];
		expect(call[1]).toEqual([]);
	});
});
