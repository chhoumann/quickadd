import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TemplateInclusionState } from "./formatter";
import type { FieldValueProcessor as FieldValueProcessorType } from "../utils/FieldValueProcessor";

/**
 * Unit tests for the concrete CompleteFormatter.
 *
 * The formatter wires together a large number of heavy collaborators (engines,
 * GUI prompts, field collectors). We mock those modules so the tests stay
 * deterministic and focus on CompleteFormatter's own behavior: the format
 * pipeline ordering, the public formatFileName/Content/FolderPath methods, global-variable
 * expansion, the concrete getter overrides, and the prompt/suggest wrappers
 * (including their cancellation -> MacroAbortError mapping).
 */

// --- Hoisted mock handles ------------------------------------------------

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
	resolveActiveDefault: vi.fn(() => null as string | string[] | null),
	dateAliases: {} as Record<string, string>,
}));

// --- Module mocks --------------------------------------------------------

vi.mock("obsidian", () => {
	// MarkdownView is only referenced as a token passed to getActiveViewOfType.
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
		templatePath: string;
		inclusion?: TemplateInclusionState;
		targetFolderPath: string | null = null;
		templatePropertyVars: Map<string, unknown> = new Map();

		constructor(
			_app: unknown,
			_plugin: unknown,
			templatePath: string,
			_choiceExecutor?: unknown,
			inclusion?: TemplateInclusionState,
		) {
			this.templatePath = templatePath;
			this.inclusion = inclusion;
		}

		setTargetFolderPath(path: string | null) {
			this.targetFolderPath = path;
		}

		run() {
			return mocks.templateRun.call(this);
		}

		getAndClearTemplatePropertyVars() {
			const vars = new Map(this.templatePropertyVars);
			this.templatePropertyVars.clear();
			return vars;
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

vi.mock("../utils/FieldValueProcessor", async () => {
	// Keep the real promoteValueToFront (issue #1429) so the active-default
	// promotion is exercised end-to-end; only getSmartDefaults is stubbed.
	const actual = (await vi.importActual(
		"../utils/FieldValueProcessor",
	)) as { FieldValueProcessor: typeof FieldValueProcessorType };
	return {
		FieldValueProcessor: {
			getSmartDefaults: mocks.getSmartDefaults,
			promoteValueToFront:
				actual.FieldValueProcessor.promoteValueToFront.bind(
					actual.FieldValueProcessor,
				),
			canonicalizeAgainst:
				actual.FieldValueProcessor.canonicalizeAgainst.bind(
					actual.FieldValueProcessor,
				),
		},
	};
});

vi.mock("../utils/activeNoteFieldDefault", () => ({
	resolveActiveNoteFieldDefault: mocks.resolveActiveDefault,
}));

vi.mock("../settingsStore", () => ({
	settingsStore: { getState: () => ({ dateAliases: mocks.dateAliases }) },
}));

// Keep the logger silent/deterministic.
vi.mock("../logger/logManager", () => ({
	log: {
		logError: vi.fn(),
		logWarning: vi.fn(),
		logMessage: vi.fn(),
	},
}));

const { CompleteFormatter } = await import("./completeFormatter");
const { MacroAbortError } = await import("../errors/MacroAbortError");
const { ChoiceAbortError } = await import("../errors/ChoiceAbortError");

// --- Test helpers --------------------------------------------------------

type FakeFile = {
	basename: string;
	parent?: { path: string } | null;
} | null;

interface FakeAppState {
	activeFile: FakeFile;
	selection: string | null; // null => no active markdown view
	generatedLink: string;
}

function makeApp(state: FakeAppState) {
	return {
		workspace: {
			getActiveFile: () => state.activeFile,
			getActiveViewOfType: () =>
				state.selection === null
					? undefined
					: { editor: { getSelection: () => state.selection } },
		},
		fileManager: {
			generateMarkdownLink: () => state.generatedLink,
		},
	};
}

function makePlugin(
	overrides: {
		globalVariables?: Record<string, string>;
		enableTemplatePropertyTypes?: boolean;
	} = {},
) {
	return {
		settings: {
			globalVariables: overrides.globalVariables ?? {},
			enableTemplatePropertyTypes:
				overrides.enableTemplatePropertyTypes ?? false,
			choices: [],
			inputPrompt: "single-line",
		},
	};
}

// Default app: no active file, no selection, empty clipboard.
function defaultFormatter(
	pluginOverrides: Parameters<typeof makePlugin>[0] = {},
	appOverrides: Partial<FakeAppState> = {},
) {
	const app = makeApp({
		activeFile: appOverrides.activeFile ?? null,
		selection: appOverrides.selection ?? null,
		generatedLink: appOverrides.generatedLink ?? "",
	});
	const plugin = makePlugin(pluginOverrides);
	return new CompleteFormatter(app as any, plugin as any);
}

function mockTemplateVault(templates: Record<string, string>) {
	mocks.templateRun.mockImplementation(async function (this: {
		templatePath: string;
		inclusion?: TemplateInclusionState;
		targetFolderPath?: string | null;
		templatePropertyVars?: Map<string, unknown>;
	}) {
		const child = defaultFormatter();
		if (this.inclusion) {
			child.setTemplateInclusionState(this.inclusion);
		}
		// Mirror SingleTemplateEngine: the child renders with the target folder
		// propagated from the including formatter (so {{FOLDER}} resolves).
		child.setTargetFolderPath(this.targetFolderPath ?? null);

		const content = await child.withTemplatePropertyCollection(() =>
			child.formatFileContent(templates[this.templatePath] ?? ""),
		);
		this.templatePropertyVars = child.getAndClearTemplatePropertyVars();
		return content;
	});
}

beforeEach(() => {
	for (const key of Object.keys(mocks.inlineParamsVariables)) {
		delete mocks.inlineParamsVariables[key];
	}
	mocks.dateAliases = {};
	vi.clearAllMocks();
	mocks.macroGetVariables.mockReturnValue(new Map());
	mocks.getSmartDefaults.mockReturnValue([]);
	mocks.resolveActiveDefault.mockReturnValue(null);

	// Deterministic clipboard: empty by default. navigator may not exist in
	// the jsdom-less environment, so define it.
	(globalThis as any).navigator = {
		clipboard: { readText: vi.fn().mockResolvedValue("") },
	};

	// Deterministic moment used by the base formatter's VDATE formatting.
	(globalThis as any).window ??= globalThis;
	(globalThis as any).window.moment = (_input?: unknown) => ({
		isValid: () => true,
		format: (fmt?: string) => (fmt === "YYYY-MM-DD" ? "2025-06-21" : "2025-06-21"),
	});
});

// =========================================================================

describe("CompleteFormatter - format pipeline (plain text)", () => {
	it("returns plain input unchanged", async () => {
		const f = defaultFormatter();
		await expect(f.formatFileContent("just some text")).resolves.toBe(
			"just some text",
		);
	});

	it("returns empty string for empty input", async () => {
		const f = defaultFormatter();
		await expect(f.formatFileContent("")).resolves.toBe("");
	});
});

describe("CompleteFormatter - global variable expansion", () => {
	it("replaces a {{GLOBAL_VAR:name}} token with its configured snippet", async () => {
		const f = defaultFormatter({ globalVariables: { greeting: "hello" } });
		await expect(
			f.formatFolderPath("say {{GLOBAL_VAR:greeting}}"),
		).resolves.toBe("say hello");
	});

	it("trims whitespace inside the variable name", async () => {
		const f = defaultFormatter({ globalVariables: { foo: "bar" } });
		await expect(
			f.formatFolderPath("{{GLOBAL_VAR:  foo  }}"),
		).resolves.toBe("bar");
	});

	it("replaces an unknown global variable with an empty string", async () => {
		const f = defaultFormatter({ globalVariables: {} });
		await expect(
			f.formatFolderPath("x{{GLOBAL_VAR:missing}}y"),
		).resolves.toBe("xy");
	});

	it("expands nested globals (snippet that itself contains a global)", async () => {
		const f = defaultFormatter({
			globalVariables: {
				outer: "[{{GLOBAL_VAR:inner}}]",
				inner: "deep",
			},
		});
		await expect(f.formatFolderPath("{{GLOBAL_VAR:outer}}")).resolves.toBe(
			"[deep]",
		);
	});

	it("does not loop forever on self-referential globals (recursion guard)", async () => {
		const f = defaultFormatter({
			globalVariables: { loop: "x{{GLOBAL_VAR:loop}}" },
		});
		// Should terminate (guard caps at 5 expansions) and not hang.
		const result = await f.formatFolderPath("{{GLOBAL_VAR:loop}}");
		expect(result.startsWith("xxxxx")).toBe(true);
		expect(typeof result).toBe("string");
	});
});

describe("CompleteFormatter - macro / template / inline-script integration", () => {
	it("replaces {{MACRO:name}} with the macro engine output", async () => {
		mocks.macroRunAndGetOutput.mockResolvedValue("MACRO_OUT");
		const f = defaultFormatter();
		await expect(f.formatFolderPath("a {{MACRO:doThing}} b")).resolves.toBe(
			"a MACRO_OUT b",
		);
		expect(mocks.macroRunAndGetOutput).toHaveBeenCalled();
	});

	it("uses an empty string when the macro engine returns nullish", async () => {
		mocks.macroRunAndGetOutput.mockResolvedValue(null);
		const f = defaultFormatter();
		await expect(f.formatFolderPath("[{{MACRO:noop}}]")).resolves.toBe("[]");
	});

	it("copies variables produced by the macro engine into the formatter", async () => {
		mocks.macroRunAndGetOutput.mockResolvedValue("done");
		mocks.macroGetVariables.mockReturnValue(
			new Map<string, unknown>([["fromMacro", "value123"]]),
		);
		const f = defaultFormatter();
		// Run a macro, then reference the variable it set via {{VALUE:fromMacro}}.
		await expect(
			f.formatFolderPath("{{MACRO:m}}-{{VALUE:fromMacro}}"),
		).resolves.toBe("done-value123");
		// The variable was reused; no prompt was needed.
		expect(mocks.inputPromptPrompt).not.toHaveBeenCalled();
	});

	it("replaces {{TEMPLATE:path}} with the template engine output", async () => {
		mocks.templateRun.mockResolvedValue("TEMPLATE_BODY");
		const f = defaultFormatter();
		await expect(
			f.formatFolderPath("{{TEMPLATE:notes/a.md}}"),
		).resolves.toBe("TEMPLATE_BODY");
	});

	it("propagates the target folder into included templates so {{FOLDER}} resolves", async () => {
		mockTemplateVault({
			"Partials/Filing.md": "folder={{FOLDER}} name={{FOLDER|name}}",
		});
		const f = defaultFormatter();
		f.setTargetFolderPath("Projects/Acme");

		const result = await f.formatFileContent("{{TEMPLATE:Partials/Filing.md}}");

		expect(result).toBe("folder=Projects/Acme name=Acme");
	});

	it("propagates structured frontmatter values collected by included templates", async () => {
		mockTemplateVault({
			"Partials/Topics.md": "---\ntopics: {{FIELD:topic|multi}}\n---\n",
		});
		mocks.fieldParse.mockReturnValue({
			fieldName: "topic",
			filters: {},
			multiSelect: true,
		});
		mocks.collectProcessedDetailed.mockResolvedValue({
			values: ["Alpha", "Beta"],
			hasDefaultValue: false,
		});
		mocks.multiSuggesterSuggest.mockResolvedValue(["Alpha", "Beta"]);
		const f = defaultFormatter();

		const result = await f.withTemplatePropertyCollection(() =>
			f.formatFileContent("{{TEMPLATE:Partials/Topics.md}}"),
		);
		const vars = f.getAndClearTemplatePropertyVars();

		expect(result).toBe("---\ntopics: []\n---\n");
		expect(vars.get("topics")).toEqual(["Alpha", "Beta"]);
	});

	it("terminates self-including templates with a visible placeholder", async () => {
		mockTemplateVault({
			"A.md": "before {{TEMPLATE:A.md}} after",
		});
		const f = defaultFormatter();

		const result = await f.formatFileContent("{{TEMPLATE:A.md}}");

		expect(result).toContain(
			'[QuickAdd: template inclusion cycle detected at "A.md"]',
		);
		expect(result).toContain("before");
		expect(result).toContain("after");
	});

	it("terminates mutually-including templates with a visible placeholder", async () => {
		mockTemplateVault({
			"A.md": "{{TEMPLATE:B.md}}",
			"B.md": "{{TEMPLATE:A.md}}",
		});
		const f = defaultFormatter();

		const result = await f.formatFileContent("{{TEMPLATE:A.md}}");

		expect(result).toContain(
			'[QuickAdd: template inclusion cycle detected at "A.md"]',
		);
	});

	it("allows repeated non-cyclic template inclusions after the stack unwinds", async () => {
		mockTemplateVault({
			"footer.md": "footer",
		});
		const f = defaultFormatter();

		const result = await f.formatFileContent(
			"{{TEMPLATE:footer.md}} and {{TEMPLATE:footer.md}}",
		);

		expect(result).toBe("footer and footer");
		expect(result).not.toContain("template inclusion cycle detected");
	});

	it("terminates over-depth template chains with a visible placeholder", async () => {
		const templates: Record<string, string> = {};
		for (let i = 0; i < 12; i++) {
			templates[`T${i}.md`] =
				i === 11 ? "leaf" : `{{TEMPLATE:T${i + 1}.md}}`;
		}
		mockTemplateVault(templates);
		const f = defaultFormatter();

		const result = await f.formatFileContent("{{TEMPLATE:T0.md}}");

		expect(result).toContain(
			'[QuickAdd: max template inclusion depth (10) exceeded at "T10.md"]',
		);
	});

	it("replaces inline JavaScript with its string output", async () => {
		mocks.inlineRunAndGetOutput.mockResolvedValue("scripted");
		const f = defaultFormatter();
		await expect(
			f.formatFolderPath("```js quickadd\nreturn 'x'\n```"),
		).resolves.toBe("scripted");
	});

	it("replaces inline JavaScript with empty string when output is non-string", async () => {
		mocks.inlineRunAndGetOutput.mockResolvedValue(42);
		const f = defaultFormatter();
		await expect(
			f.formatFolderPath("[```js quickadd\n1+1\n```]"),
		).resolves.toBe("[]");
	});

	it("propagates variables set by the inline script", async () => {
		// The script block is replaced by its output ("") and the variable it
		// registered becomes available for the following {{VALUE}} token.
		mocks.inlineRunAndGetOutput.mockResolvedValue("");
		mocks.inlineParamsVariables.scriptVar = "fromScript";
		const f = defaultFormatter();
		await expect(
			f.formatFolderPath("```js quickadd\nnoop\n```{{VALUE:scriptVar}}"),
		).resolves.toBe("fromScript");
	});
});

describe("CompleteFormatter - empty-token loop termination (regression)", () => {
	it(
		"consumes an empty {{MACRO:}} token and does not hang",
		async () => {
			const f = defaultFormatter();
			await expect(f.formatFolderPath("a {{MACRO:}} b")).resolves.toBe(
				"a  b",
			);
			// The empty token is consumed without ever invoking the macro engine.
			expect(mocks.macroRunAndGetOutput).not.toHaveBeenCalled();
		},
		2000,
	);

	it(
		"consumes an empty ```js quickadd``` fence and does not hang",
		async () => {
			const f = defaultFormatter();
			await expect(
				f.formatFolderPath("x```js quickadd\n```y"),
			).resolves.toBe("xy");
			// The empty fence is consumed without ever invoking the inline-script engine.
			expect(mocks.inlineRunAndGetOutput).not.toHaveBeenCalled();
		},
		2000,
	);
});

describe("CompleteFormatter - getCurrentFileLink / getCurrentFileName", () => {
	it("replaces {{LINKCURRENT}} with the generated markdown link", async () => {
		const f = defaultFormatter(
			{},
			{ activeFile: { basename: "Note" }, generatedLink: "[[Note]]" },
		);
		await expect(f.formatFileContent("see {{LINKCURRENT}}")).resolves.toBe(
			"see [[Note]]",
		);
	});

	it("throws (required behavior) when {{LINKCURRENT}} but no active file", async () => {
		const f = defaultFormatter({}, { activeFile: null });
		await expect(f.formatFileContent("{{LINKCURRENT}}")).rejects.toThrow(
			"Unable to get current file path",
		);
	});

	it("replaces {{FILENAMECURRENT}} with the active file basename", async () => {
		const f = defaultFormatter({}, { activeFile: { basename: "My File" } });
		await expect(
			f.formatFileContent("name: {{FILENAMECURRENT}}"),
		).resolves.toBe("name: My File");
	});

	it("throws when {{FILENAMECURRENT}} but no active file (required behavior)", async () => {
		const f = defaultFormatter({}, { activeFile: null });
		await expect(
			f.formatFileContent("{{FILENAMECURRENT}}"),
		).rejects.toThrow("Unable to get current file name");
	});
});

// End-to-end guards for #1358 driven through the REAL entry points (not the
// combined helper directly), so a future revert to sequential token passes —
// where a later pass re-scans an earlier pass's generated output — is caught
// here. The combined-resolver unit semantics live in
// formatter-token-named-file.test.ts.
describe("CompleteFormatter - #1358 token-named active file (production wiring)", () => {
	it("formatFileContent keeps a generated link intact when the active file is named {{folder}}", async () => {
		// Real-app repro: file '{{folder}}.md' + body {{LINKCURRENT}} used to
		// produce [[]] because the folder pass re-scanned the generated link.
		const f = defaultFormatter(
			{},
			{ activeFile: { basename: "{{folder}}" }, generatedLink: "[[{{folder}}]]" },
		);
		await expect(f.formatFileContent("{{LINKCURRENT}}")).resolves.toBe(
			"[[{{folder}}]]",
		);
	});

	it("formatFileContent keeps a generated link intact when the active file is named {{title}}", async () => {
		const f = defaultFormatter(
			{},
			{ activeFile: { basename: "{{title}}" }, generatedLink: "[[{{title}}]]" },
		);
		f.setTitle("Brand New Title");
		await expect(f.formatFileContent("{{LINKCURRENT}}")).resolves.toBe(
			"[[{{title}}]]",
		);
	});

	it("formatFileContent does not hang when the active file is literally named {{filenamecurrent}}", async () => {
		// Would infinite-loop on the old while-loop replacer; the test completing
		// IS the assertion that the loop is gone.
		const f = defaultFormatter(
			{},
			{ activeFile: { basename: "{{filenamecurrent}}" } },
		);
		await expect(f.formatFileContent("{{FILENAMECURRENT}}")).resolves.toBe(
			"{{filenamecurrent}}",
		);
	});

	it("formatFileName does not let the folder pass rewrite a {{folder}}-named basename", async () => {
		const f = defaultFormatter(
			{},
			{ activeFile: { basename: "{{folder}}" } },
		);
		f.setTargetFolderPath("Projects");
		// {{FILENAMECURRENT}} -> '{{folder}}' (the basename); the folder pass must
		// NOT then rewrite that to 'Projects'.
		await expect(f.formatFileName("{{FILENAMECURRENT}}", "header")).resolves.toBe(
			"{{folder}}",
		);
	});
});

describe("CompleteFormatter - {{FOLDERCURRENT}} (issue #1480)", () => {
	const activeInAlpha: FakeFile = {
		basename: "Meeting",
		parent: { path: "Projects/Alpha" },
	};

	it("formatFileName resolves a sibling capture target from the active file's folder", async () => {
		const f = defaultFormatter({}, { activeFile: activeInAlpha });
		await expect(
			f.formatFileName("{{FOLDERCURRENT}}/Project Tasks.md", "Value"),
		).resolves.toBe("Projects/Alpha/Project Tasks.md");
	});

	it("formatFileName resolves {{FOLDERCURRENT|name}} to the leaf folder", async () => {
		const f = defaultFormatter({}, { activeFile: activeInAlpha });
		await expect(
			f.formatFileName("{{FOLDERCURRENT|name}} - notes", "Value"),
		).resolves.toBe("Alpha - notes");
	});

	it("collapses the root folder path '/' to an empty string", async () => {
		const f = defaultFormatter(
			{},
			{ activeFile: { basename: "RootNote", parent: { path: "/" } } },
		);
		// Downstream path normalization strips the leading slash, so a root-level
		// note captures to a root-level sibling.
		await expect(
			f.formatFileName("{{FOLDERCURRENT}}/Tasks.md", "Value"),
		).resolves.toBe("/Tasks.md");
	});

	it("formatFileContent resolves the token in a note body", async () => {
		const f = defaultFormatter({}, { activeFile: activeInAlpha });
		await expect(
			f.formatFileContent("Filed under {{foldercurrent}}"),
		).resolves.toBe("Filed under Projects/Alpha");
	});

	it("formatFolderPath resolves the token (and composes with a subpath)", async () => {
		const f = defaultFormatter({}, { activeFile: activeInAlpha });
		await expect(
			f.formatFolderPath("{{FOLDERCURRENT}}/Subnotes"),
		).resolves.toBe("Projects/Alpha/Subnotes");
	});

	it("formatFileName throws without an active file, even in optional mode (no silent root capture)", async () => {
		const f = defaultFormatter({}, { activeFile: null });
		f.setLinkToCurrentFileBehavior("optional");
		await expect(
			f.formatFileName("{{FOLDERCURRENT}}/Tasks.md", "Value"),
		).rejects.toThrow("Unable to get the active file's folder");
	});

	it("formatFolderPath strips the leading slash a root-level active file produces", async () => {
		const f = defaultFormatter(
			{},
			{ activeFile: { basename: "RootNote", parent: { path: "/" } } },
		);
		// "" + "/Subnotes" would otherwise reach validateFolderPath as an empty
		// first segment and silently fall back to the vault root.
		await expect(
			f.formatFolderPath("{{FOLDERCURRENT}}/Subnotes"),
		).resolves.toBe("Subnotes");
	});

	it("formatFolderPath throws without an active file", async () => {
		const f = defaultFormatter({}, { activeFile: null });
		await expect(f.formatFolderPath("{{FOLDERCURRENT}}")).rejects.toThrow(
			"Unable to get the active file's folder",
		);
	});

	it("formatFileContent strips the token in optional mode without an active file", async () => {
		const f = defaultFormatter({}, { activeFile: null });
		f.setLinkToCurrentFileBehavior("optional");
		await expect(
			f.formatFileContent("in [{{FOLDERCURRENT}}]"),
		).resolves.toBe("in []");
	});

	it("does not re-scan a folder literally named like a token (#1358)", async () => {
		const f = defaultFormatter(
			{},
			{
				activeFile: {
					basename: "Meeting",
					parent: { path: "{{filenamecurrent}}" },
				},
			},
		);
		await expect(
			f.formatFileName("{{FOLDERCURRENT}}/{{FILENAMECURRENT}}", "Value"),
		).resolves.toBe("{{filenamecurrent}}/Meeting");
	});
});

describe("CompleteFormatter - title handling", () => {
	it("replaces {{title}} in file content with the set title", async () => {
		const f = defaultFormatter();
		f.setTitle("Document Title");
		await expect(f.formatFileContent("# {{title}}")).resolves.toBe(
			"# Document Title",
		);
	});

	it("formatFileName rejects {{title}} to avoid circular dependency", async () => {
		const f = defaultFormatter();
		await expect(
			f.formatFileName("{{title}}-suffix", "Value"),
		).rejects.toThrow("circular dependency");
	});

	it("formatFolderPath rejects {{title}} to avoid circular dependency", async () => {
		const f = defaultFormatter();
		await expect(f.formatFolderPath("folder/{{title}}")).rejects.toThrow(
			"circular dependency",
		);
	});

	it("formatFileName appends current file name replacement", async () => {
		const f = defaultFormatter(
			{},
			{ activeFile: { basename: "Source" } },
		);
		await expect(
			f.formatFileName("{{FILENAMECURRENT}}-note", "Value"),
		).resolves.toBe("Source-note");
	});
});

describe("CompleteFormatter - selection handling", () => {
	it("uses the editor selection for {{SELECTED}}", async () => {
		const f = defaultFormatter({}, { selection: "highlighted text" });
		await expect(
			f.formatFolderPath("Q: {{SELECTED}}"),
		).resolves.toBe("Q: highlighted text");
	});

	it("replaces {{SELECTED}} with empty string when no active markdown view", async () => {
		const f = defaultFormatter({}, { selection: null });
		await expect(f.formatFolderPath("[{{SELECTED}}]")).resolves.toBe("[]");
	});

	it("uses selected text as the {{VALUE}} when a selection exists", async () => {
		const f = defaultFormatter({}, { selection: "picked" });
		await expect(f.formatFolderPath("v={{VALUE}}")).resolves.toBe(
			"v=picked",
		);
		// Selection short-circuits the prompt.
		expect(mocks.inputPromptPrompt).not.toHaveBeenCalled();
	});

	it("normalizes selected text for anonymous bounded number VALUE", async () => {
		const f = defaultFormatter({}, { selection: "999" });
		await expect(
			f.formatFolderPath("v={{VALUE|type:number|min:1|max:10|step:2}}"),
		).resolves.toBe("v=10");
		expect(mocks.inputPromptPrompt).not.toHaveBeenCalled();
	});

	it("prompts when selected text is invalid for anonymous number VALUE", async () => {
		mocks.inputPromptPrompt.mockResolvedValue("4");
		const f = defaultFormatter({}, { selection: "not a number" });
		await expect(
			f.formatFolderPath("v={{VALUE|type:number|min:1|max:10|step:1}}"),
		).resolves.toBe("v=4");
		expect(mocks.inputPromptPrompt).toHaveBeenCalledTimes(1);
	});
});

describe("CompleteFormatter - clipboard handling", () => {
	it("replaces {{CLIPBOARD}} with clipboard contents", async () => {
		(globalThis as any).navigator = {
			clipboard: { readText: vi.fn().mockResolvedValue("copied!") },
		};
		const f = defaultFormatter();
		await expect(f.formatFolderPath("{{CLIPBOARD}}")).resolves.toBe(
			"copied!",
		);
	});

	it("falls back to empty string when clipboard read rejects", async () => {
		(globalThis as any).navigator = {
			clipboard: {
				readText: vi.fn().mockRejectedValue(new Error("denied")),
			},
		};
		const f = defaultFormatter();
		await expect(f.formatFolderPath("[{{CLIPBOARD}}]")).resolves.toBe("[]");
	});
});

describe("CompleteFormatter - {{VALUE}} prompting", () => {
	it("prompts for value and reuses it across multiple tokens", async () => {
		mocks.inputPromptPrompt.mockResolvedValue("typed");
		const f = defaultFormatter();
		await expect(
			f.formatFolderPath("{{VALUE}}-{{VALUE}}"),
		).resolves.toBe("typed-typed");
		// Prompt happens once per run.
		expect(mocks.inputPromptPrompt).toHaveBeenCalledTimes(1);
	});

	it("passes slider configuration to anonymous VALUE prompts", async () => {
		mocks.inputPromptPrompt.mockResolvedValue("7");
		const f = defaultFormatter();
		await expect(
			f.formatFolderPath(
				"{{VALUE|type:slider|min:1|max:10|step:1|default:5|optional}}",
			),
		).resolves.toBe("7");
		expect(mocks.inputPromptFactory).toHaveBeenCalledWith("slider");
		expect(mocks.inputPromptPrompt).toHaveBeenCalledWith(
			expect.anything(),
			"Enter value",
			undefined,
			"5",
			undefined,
			{
				optional: true,
				numeric: { min: 1, max: 10, step: 1 },
				slider: { min: 1, max: 10, step: 1 },
			},
		);
	});

	it("wraps a user-cancellation in MacroAbortError", async () => {
		// isCancellationError only treats specific string messages as cancels.
		mocks.inputPromptPrompt.mockRejectedValue("No input given.");
		const f = defaultFormatter();
		await expect(f.formatFolderPath("{{VALUE}}")).rejects.toBeInstanceOf(
			MacroAbortError,
		);
	});

	it("re-throws non-cancellation errors as-is", async () => {
		const realError = new Error("network down");
		mocks.inputPromptPrompt.mockRejectedValue(realError);
		const f = defaultFormatter();
		await expect(f.formatFolderPath("{{VALUE}}")).rejects.toBe(realError);
	});
});

describe("CompleteFormatter - non-interactive guard (CLI without ui)", () => {
	// A non-interactive ChoiceExecutor: the formatter must abort any token prompt
	// (instead of hanging on an unanswerable modal) when a value wasn't provided.
	const nonInteractiveFormatter = () => {
		const app = makeApp({ activeFile: null, selection: null, generatedLink: "" });
		const plugin = makePlugin({});
		return new CompleteFormatter(app as any, plugin as any, {
			variables: new Map<string, unknown>(),
			interactive: false,
			execute: vi.fn(),
		} as any);
	};

	it("aborts on an unresolved anonymous {{VALUE}} without opening the prompt", async () => {
		mocks.inputPromptPrompt.mockResolvedValue("typed");
		const f = nonInteractiveFormatter();
		await expect(f.formatFolderPath("{{VALUE}}")).rejects.toBeInstanceOf(
			ChoiceAbortError,
		);
		expect(mocks.inputPromptPrompt).not.toHaveBeenCalled();
	});

	it("aborts on an unresolved {{VALUE:opts}} suggester without opening it", async () => {
		mocks.genericSuggesterSuggest.mockResolvedValue("a");
		const f = nonInteractiveFormatter();
		await expect(
			f.formatFolderPath("{{VALUE:a,b,c}}"),
		).rejects.toBeInstanceOf(ChoiceAbortError);
		expect(mocks.genericSuggesterSuggest).not.toHaveBeenCalled();
	});

	it("does NOT abort when the value is provided up front", async () => {
		const app = makeApp({ activeFile: null, selection: null, generatedLink: "" });
		const plugin = makePlugin({});
		const f = new CompleteFormatter(app as any, plugin as any, {
			variables: new Map<string, unknown>([["value", "Given"]]),
			interactive: false,
			execute: vi.fn(),
		} as any);
		await expect(f.formatFolderPath("{{VALUE}}")).resolves.toBe("Given");
		expect(mocks.inputPromptPrompt).not.toHaveBeenCalled();
	});
});

describe("CompleteFormatter - {{VALUE:variable}} prompting", () => {
	it("prompts for a named variable via the input prompt", async () => {
		mocks.inputPromptPrompt.mockResolvedValue("Alice");
		const f = defaultFormatter();
		await expect(f.formatFolderPath("{{VALUE:name}}")).resolves.toBe(
			"Alice",
		);
	});

	it("passes numeric configuration to named VALUE prompts", async () => {
		mocks.inputPromptPrompt.mockResolvedValue("5");
		const f = defaultFormatter();
		await expect(
			f.formatFolderPath("{{VALUE:rating|type:number|min:1|max:10|step:1}}"),
		).resolves.toBe("5");
		expect(mocks.inputPromptFactory).toHaveBeenCalledWith("number");
		expect(mocks.inputPromptPrompt).toHaveBeenCalledWith(
			expect.anything(),
			"rating",
			undefined,
			"",
			undefined,
			{
				optional: false,
				numeric: { min: 1, max: 10, step: 1 },
				slider: undefined,
			},
		);
	});

	it("uses the suggester for comma-separated option lists", async () => {
		mocks.genericSuggesterSuggest.mockResolvedValue("Green");
		const f = defaultFormatter();
		await expect(
			f.formatFolderPath("{{VALUE:Red,Green,Blue}}"),
		).resolves.toBe("Green");
		expect(mocks.genericSuggesterSuggest).toHaveBeenCalled();
	});

	it("maps a suggester cancellation to MacroAbortError", async () => {
		mocks.genericSuggesterSuggest.mockRejectedValue("No input given.");
		const f = defaultFormatter();
		await expect(
			f.formatFolderPath("{{VALUE:A,B}}"),
		).rejects.toBeInstanceOf(MacroAbortError);
	});
});

describe("CompleteFormatter - VDATE variable prompting", () => {
	it("prompts via VDateInputPrompt and formats the resolved date", async () => {
		// Returning an @date: prefixed value stores it directly; window.moment
		// (from the obsidian stub) formats it deterministically.
		mocks.vdatePrompt.mockResolvedValue(
			"@date:2025-06-21T00:00:00.000Z",
		);
		const f = defaultFormatter();
		await expect(
			f.formatFolderPath("{{VDATE:due,YYYY-MM-DD}}"),
		).resolves.toBe("2025-06-21");
		expect(mocks.vdatePrompt).toHaveBeenCalled();
	});
});

describe("CompleteFormatter - math value prompting", () => {
	it("replaces {{MVALUE}} with the math modal result", async () => {
		mocks.mathPrompt.mockResolvedValue("42");
		const f = defaultFormatter();
		await expect(f.formatFolderPath("= {{MVALUE}}")).resolves.toBe("= 42");
	});

	it("maps a math modal cancellation to MacroAbortError", async () => {
		mocks.mathPrompt.mockRejectedValue("No input given.");
		const f = defaultFormatter();
		await expect(f.formatFolderPath("{{MVALUE}}")).rejects.toBeInstanceOf(
			MacroAbortError,
		);
	});
});

describe("CompleteFormatter - field suggestion (suggestForField)", () => {
	it("suggests from collected values when matches exist", async () => {
		mocks.fieldParse.mockReturnValue({
			fieldName: "status",
			filters: {},
		});
		mocks.collectProcessedDetailed.mockResolvedValue({
			values: ["open", "closed"],
			hasDefaultValue: false,
		});
		mocks.inputSuggesterSuggest.mockResolvedValue("open");

		const f = defaultFormatter();
		await expect(f.formatFolderPath("{{FIELD:status}}")).resolves.toBe(
			"open",
		);
		expect(mocks.inputSuggesterSuggest).toHaveBeenCalled();
	});

	it("uses the multi-suggester for FIELD multi-select values", async () => {
		mocks.fieldParse.mockReturnValue({
			fieldName: "topic",
			filters: {},
			multiSelect: true,
		});
		mocks.collectProcessedDetailed.mockResolvedValue({
			values: ["Alpha", "Beta"],
			hasDefaultValue: false,
		});
		mocks.multiSuggesterSuggest.mockResolvedValue(["Alpha", "Beta"]);

		const f = defaultFormatter();
		await expect(f.formatFolderPath("{{FIELD:topic|multi}}")).resolves.toBe(
			"Alpha,Beta",
		);
		expect(mocks.multiSuggesterSuggest).toHaveBeenCalledWith(
			expect.anything(),
			["Alpha", "Beta"],
			["Alpha", "Beta"],
			expect.objectContaining({
				placeholder: "Select values for topic",
				allowCustomValue: true,
			}),
		);
		expect(mocks.inputSuggesterSuggest).not.toHaveBeenCalled();
	});

	it("keeps FIELD multi-select usable when no existing values are found", async () => {
		mocks.fieldParse.mockReturnValue({
			fieldName: "topic",
			filters: {},
			multiSelect: true,
		});
		mocks.collectProcessedDetailed.mockResolvedValue({
			values: [],
			hasDefaultValue: false,
		});
		mocks.multiSuggesterSuggest.mockResolvedValue(["Manual"]);

		const f = defaultFormatter();
		await expect(f.formatFolderPath("{{FIELD:topic|multi}}")).resolves.toBe(
			"Manual",
		);
		expect(mocks.multiSuggesterSuggest).toHaveBeenCalledWith(
			expect.anything(),
			[],
			[],
			expect.objectContaining({ allowCustomValue: true }),
		);
		expect(mocks.genericInputPromptWithContext).not.toHaveBeenCalled();
	});

	it("falls back to a free-form prompt when no values are found", async () => {
		mocks.fieldParse.mockReturnValue({
			fieldName: "status",
			filters: {},
		});
		mocks.collectProcessedDetailed.mockResolvedValue({
			values: [],
			hasDefaultValue: false,
		});
		mocks.genericInputPromptWithContext.mockResolvedValue("manual");

		const f = defaultFormatter();
		await expect(f.formatFolderPath("{{FIELD:status}}")).resolves.toBe(
			"manual",
		);
		expect(mocks.genericInputPromptWithContext).toHaveBeenCalled();
		expect(mocks.inputSuggesterSuggest).not.toHaveBeenCalled();
	});

	it("maps a field-suggester cancellation to MacroAbortError", async () => {
		mocks.fieldParse.mockReturnValue({
			fieldName: "status",
			filters: {},
		});
		mocks.collectProcessedDetailed.mockResolvedValue({
			values: ["a"],
			hasDefaultValue: false,
		});
		mocks.inputSuggesterSuggest.mockRejectedValue("no input given.");

		const f = defaultFormatter();
		await expect(
			f.formatFolderPath("{{FIELD:status}}"),
		).rejects.toBeInstanceOf(MacroAbortError);
	});
});

describe("CompleteFormatter - FIELD default-from:active (issue #1429)", () => {
	// A formatter whose choiceExecutor carries a trigger-time active file, so the
	// resolver receives the captured file (and we can assert it).
	function formatterWithActiveFile(activeFile: unknown) {
		const app = makeApp({
			activeFile: null,
			selection: null,
			generatedLink: "",
		});
		const choiceExecutor = {
			variables: new Map<string, unknown>(),
			triggerContext: { activeFile },
		};
		return new CompleteFormatter(
			app as any,
			makePlugin() as any,
			choiceExecutor as any,
		);
	}

	it("promotes the active note's scalar value to the top suggestion and accepts it", async () => {
		const activeFile = { extension: "md", path: "Active.md" };
		mocks.fieldParse.mockReturnValue({
			fieldName: "project",
			filters: { defaultFrom: "active" },
		});
		mocks.collectProcessedDetailed.mockResolvedValue({
			values: ["Old Project", "The Great Endeavor"],
			hasDefaultValue: false,
		});
		mocks.resolveActiveDefault.mockReturnValue("The Great Endeavor");
		mocks.inputSuggesterSuggest.mockImplementation(
			(_app, _display, items) => Promise.resolve(items[0]),
		);

		const f = formatterWithActiveFile(activeFile);
		await expect(
			f.formatFolderPath("{{FIELD:project|default-from:active}}"),
		).resolves.toBe("The Great Endeavor");

		// The resolver was handed the captured trigger-time active file.
		expect(mocks.resolveActiveDefault).toHaveBeenCalledWith(
			expect.anything(),
			activeFile,
			"project",
		);
		// The active value is promoted to the front, de-duplicated.
		const [, , items, opts] = mocks.inputSuggesterSuggest.mock.calls[0];
		expect(items).toEqual(["The Great Endeavor", "Old Project"]);
		expect(opts.placeholder).toContain("default: The Great Endeavor");
	});

	it("prepends the active value when it is not already a vault suggestion", async () => {
		mocks.fieldParse.mockReturnValue({
			fieldName: "project",
			filters: { defaultFrom: "active" },
		});
		mocks.collectProcessedDetailed.mockResolvedValue({
			values: ["Other"],
			hasDefaultValue: false,
		});
		mocks.resolveActiveDefault.mockReturnValue("Fresh");
		mocks.inputSuggesterSuggest.mockResolvedValue("Fresh");

		const f = formatterWithActiveFile({ extension: "md", path: "A.md" });
		await f.formatFolderPath("{{FIELD:project|default-from:active}}");

		const [, , items] = mocks.inputSuggesterSuggest.mock.calls[0];
		expect(items).toEqual(["Fresh", "Other"]);
	});

	it("falls back to normal FIELD behavior when there is no active default", async () => {
		mocks.fieldParse.mockReturnValue({
			fieldName: "project",
			filters: { defaultFrom: "active" },
		});
		mocks.collectProcessedDetailed.mockResolvedValue({
			values: ["A", "B"],
			hasDefaultValue: false,
		});
		mocks.resolveActiveDefault.mockReturnValue(null);
		mocks.inputSuggesterSuggest.mockResolvedValue("A");

		const f = formatterWithActiveFile(null);
		await f.formatFolderPath("{{FIELD:project|default-from:active}}");

		const [, , items, opts] = mocks.inputSuggesterSuggest.mock.calls[0];
		expect(items).toEqual(["A", "B"]);
		expect(opts.placeholder).not.toContain("default:");
	});

	it("does NOT resolve an active default for a plain FIELD (no default-from)", async () => {
		mocks.fieldParse.mockReturnValue({ fieldName: "project", filters: {} });
		mocks.collectProcessedDetailed.mockResolvedValue({
			values: ["A"],
			hasDefaultValue: false,
		});
		mocks.inputSuggesterSuggest.mockResolvedValue("A");

		const f = formatterWithActiveFile({ extension: "md", path: "A.md" });
		await f.formatFolderPath("{{FIELD:project}}");

		expect(mocks.resolveActiveDefault).not.toHaveBeenCalled();
	});

	it("pre-checks the active note's list value in the multi-select picker", async () => {
		mocks.fieldParse.mockReturnValue({
			fieldName: "topics",
			filters: { defaultFrom: "active" },
			multiSelect: true,
		});
		mocks.collectProcessedDetailed.mockResolvedValue({
			values: ["Alpha", "Beta", "Gamma"],
			hasDefaultValue: false,
		});
		mocks.resolveActiveDefault.mockReturnValue(["Beta", "Zeta"]);
		mocks.multiSuggesterSuggest.mockResolvedValue(["Beta", "Zeta"]);

		const f = formatterWithActiveFile({ extension: "md", path: "A.md" });
		await expect(
			f.formatFolderPath("{{FIELD:topics|multi|default-from:active}}"),
		).resolves.toBe("Beta,Zeta");

		const [, , , opts] = mocks.multiSuggesterSuggest.mock.calls[0];
		expect(opts.preselected).toEqual(["Beta", "Zeta"]);
		expect(opts.allowCustomValue).toBe(true);
	});

	it("canonicalizes a case-variant active value onto the collected option (no duplicate row)", async () => {
		mocks.fieldParse.mockReturnValue({
			fieldName: "topics",
			filters: { defaultFrom: "active" },
			multiSelect: true,
		});
		mocks.collectProcessedDetailed.mockResolvedValue({
			values: ["done", "open"],
			hasDefaultValue: false,
		});
		// Active note uses different casing than the collected vault value.
		mocks.resolveActiveDefault.mockReturnValue(["Done"]);
		mocks.multiSuggesterSuggest.mockResolvedValue(["done"]);

		const f = formatterWithActiveFile({ extension: "md", path: "A.md" });
		await f.formatFolderPath("{{FIELD:topics|multi|default-from:active}}");

		const [, , , opts] = mocks.multiSuggesterSuggest.mock.calls[0];
		// "Done" is folded onto the collected "done" option, not added as custom.
		expect(opts.preselected).toEqual(["done"]);
	});

	it("pre-checks a scalar active value in a multi-select picker as a single item", async () => {
		mocks.fieldParse.mockReturnValue({
			fieldName: "topics",
			filters: { defaultFrom: "active" },
			multiSelect: true,
		});
		mocks.collectProcessedDetailed.mockResolvedValue({
			values: ["Alpha"],
			hasDefaultValue: false,
		});
		mocks.resolveActiveDefault.mockReturnValue("Alpha");
		mocks.multiSuggesterSuggest.mockResolvedValue(["Alpha"]);

		const f = formatterWithActiveFile({ extension: "md", path: "A.md" });
		await f.formatFolderPath("{{FIELD:topics|multi|default-from:active}}");

		const [, , , opts] = mocks.multiSuggesterSuggest.mock.calls[0];
		expect(opts.preselected).toEqual(["Alpha"]);
	});

	it("does not preselect anything in multi when there is no active value", async () => {
		mocks.fieldParse.mockReturnValue({
			fieldName: "topics",
			filters: { defaultFrom: "active" },
			multiSelect: true,
		});
		mocks.collectProcessedDetailed.mockResolvedValue({
			values: ["Alpha"],
			hasDefaultValue: false,
		});
		mocks.resolveActiveDefault.mockReturnValue(null);
		mocks.multiSuggesterSuggest.mockResolvedValue([]);

		const f = formatterWithActiveFile(null);
		await f.formatFolderPath("{{FIELD:topics|multi|default-from:active}}");

		const [, , , opts] = mocks.multiSuggesterSuggest.mock.calls[0];
		expect(opts.preselected).toBeUndefined();
	});

	it("does not prefill a single-select default when the active value is a list", async () => {
		mocks.fieldParse.mockReturnValue({
			fieldName: "project",
			filters: { defaultFrom: "active" },
		});
		mocks.collectProcessedDetailed.mockResolvedValue({
			values: ["A", "B"],
			hasDefaultValue: false,
		});
		mocks.resolveActiveDefault.mockReturnValue(["X", "Y"]);
		mocks.inputSuggesterSuggest.mockResolvedValue("A");

		const f = formatterWithActiveFile({ extension: "md", path: "A.md" });
		await f.formatFolderPath("{{FIELD:project|default-from:active}}");

		const [, , items, opts] = mocks.inputSuggesterSuggest.mock.calls[0];
		expect(items).toEqual(["A", "B"]);
		expect(opts.placeholder).not.toContain("default:");
	});
});

describe("CompleteFormatter - constructor / dateParser injection", () => {
	it("uses an injected date parser for VDATE coercion", async () => {
		const injectedParser = {
			parseDate: vi.fn().mockReturnValue({
				moment: {
					format: () => "2030-01-01",
					toISOString: () => "2030-01-01T00:00:00.000Z",
					isValid: () => true,
				},
			}),
		};
		const app = makeApp({
			activeFile: null,
			selection: null,
			generatedLink: "",
		});
		// Non-@date: response forces a parseDate() coercion through the parser.
		mocks.vdatePrompt.mockResolvedValue("tomorrow");
		const f = new CompleteFormatter(
			app as any,
			makePlugin() as any,
			undefined,
			injectedParser,
		);
		await f.formatFolderPath("{{VDATE:when,YYYY-MM-DD}}");
		expect(injectedParser.parseDate).toHaveBeenCalled();
	});

	it("shares variables from a provided choiceExecutor", async () => {
		const sharedVars = new Map<string, unknown>([["preset", "shared!"]]);
		const choiceExecutor = { variables: sharedVars };
		const app = makeApp({
			activeFile: null,
			selection: null,
			generatedLink: "",
		});
		const f = new CompleteFormatter(
			app as any,
			makePlugin() as any,
			choiceExecutor as any,
		);
		// preset already lives in the shared map, so no prompt should fire.
		await expect(
			f.formatFolderPath("{{VALUE:preset}}"),
		).resolves.toBe("shared!");
		expect(mocks.inputPromptPrompt).not.toHaveBeenCalled();
	});
});

describe("CompleteFormatter - pipeline ordering", () => {
	it("formats a macro's output further down the pipeline (date etc.)", async () => {
		// Macro emits a global-var token; because globals are expanded after
		// macros, the injected token is itself resolved.
		mocks.macroRunAndGetOutput.mockResolvedValue("{{GLOBAL_VAR:g}}");
		const f = defaultFormatter({ globalVariables: { g: "resolved" } });
		await expect(f.formatFolderPath("{{MACRO:m}}")).resolves.toBe(
			"resolved",
		);
	});
});

describe("CompleteFormatter - formatTemplateFilePath (issue #620)", () => {
	it("returns a literal (token-free) path unchanged", async () => {
		const f = defaultFormatter();
		await expect(
			f.formatTemplateFilePath("Templates/Note.md"),
		).resolves.toBe("Templates/Note.md");
	});

	it("resolves a named {{VALUE:x}} token in the path", async () => {
		mocks.inputPromptPrompt.mockResolvedValue("Games");
		const f = defaultFormatter();
		await expect(
			f.formatTemplateFilePath("Templates/{{VALUE:type}} Template.md"),
		).resolves.toBe("Templates/Games Template.md");
	});

	it("throws on {{title}} (the title derives from the created file)", async () => {
		const f = defaultFormatter();
		await expect(
			f.formatTemplateFilePath("Templates/{{title}}.md"),
		).rejects.toThrow(/title/i);
	});

	it("throws on {{title}} even when injected via a global variable", async () => {
		const f = defaultFormatter({
			globalVariables: { p: "Templates/{{title}}.md" },
		});
		await expect(
			f.formatTemplateFilePath("{{GLOBAL_VAR:p}}"),
		).rejects.toThrow(/title/i);
	});

	it("leaves {{FOLDER}} literal — meaningless in a source path", async () => {
		const f = defaultFormatter();
		f.setTargetFolderPath("Projects/Acme");
		await expect(
			f.formatTemplateFilePath("Templates/{{FOLDER}}/Note.md"),
		).resolves.toBe("Templates/{{FOLDER}}/Note.md");
	});

	it("does NOT run macros to compute a path (left literal, never executed)", async () => {
		const f = defaultFormatter();
		await expect(
			f.formatTemplateFilePath("Templates/{{MACRO:foo}}.md"),
		).resolves.toBe("Templates/{{MACRO:foo}}.md");
		expect(mocks.macroRunAndGetOutput).not.toHaveBeenCalled();
	});

	it("does NOT splice {{TEMPLATE:}} inclusion into a path", async () => {
		const f = defaultFormatter();
		await expect(
			f.formatTemplateFilePath("Templates/{{TEMPLATE:partial.md}}.md"),
		).resolves.toBe("Templates/{{TEMPLATE:partial.md}}.md");
		expect(mocks.templateRun).not.toHaveBeenCalled();
	});

	it("trims the resolved path so the extension and lookup can't disagree", async () => {
		const f = defaultFormatter();
		await expect(
			f.formatTemplateFilePath("  Templates/Note.md  "),
		).resolves.toBe("Templates/Note.md");
	});
});

// --- {{linksection}} runtime resolver (issue #387) -----------------------
// Exercises CompleteFormatter.getCurrentFileLinkToSection's glue: the active-
// view/cursor guards and the whole-file / throw fallbacks. The heading parsing
// and disambiguation logic itself is unit-tested in helpers/sectionLink.test.ts.

function makeSectionView(opts: {
	path: string;
	mode?: "source" | "preview";
	cursorLine?: number;
	value?: string;
	getValueThrows?: boolean;
}) {
	return {
		file: { path: opts.path },
		getMode: () => opts.mode ?? "source",
		editor: {
			getSelection: () => "",
			getCursor: () => ({ line: opts.cursorLine ?? 0, ch: 0 }),
			getValue: () => {
				if (opts.getValueThrows) throw new Error("boom");
				return opts.value ?? "";
			},
		},
	};
}

function makeSectionApp(opts: {
	activeFile?: { basename: string; path: string } | null;
	view?: ReturnType<typeof makeSectionView> | undefined;
}) {
	const activeFile =
		opts.activeFile === undefined
			? { basename: "Note", path: "Note.md" }
			: opts.activeFile;
	return {
		workspace: {
			getActiveFile: () => activeFile,
			getActiveViewOfType: () => opts.view,
		},
		fileManager: {
			generateMarkdownLink: (
				file: { basename: string },
				_src: string,
				subpath?: string,
			) => (subpath ? `[[${file.basename}${subpath}]]` : `[[${file.basename}]]`),
		},
		metadataCache: { getFileCache: () => null },
	};
}

const BODY = ["# Project", "", "## Tasks", "- a", "- b"].join("\n");

describe("CompleteFormatter {{linksection}} runtime resolution", () => {
	it("links to the heading the cursor is under", async () => {
		const app = makeSectionApp({
			view: makeSectionView({ path: "Note.md", cursorLine: 3, value: BODY }),
		});
		const f = new CompleteFormatter(app as any, makePlugin() as any);
		await expect(f.formatFileContent("{{linksection}}")).resolves.toBe(
			"[[Note#Tasks]]",
		);
	});

	it("works for CRLF buffers", async () => {
		const app = makeSectionApp({
			view: makeSectionView({
				path: "Note.md",
				cursorLine: 3,
				value: BODY.replace(/\n/g, "\r\n"),
			}),
		});
		const f = new CompleteFormatter(app as any, makePlugin() as any);
		await expect(f.formatFileContent("{{linksection}}")).resolves.toBe(
			"[[Note#Tasks]]",
		);
	});

	it("falls back to a whole-file link in reading mode", async () => {
		const app = makeSectionApp({
			view: makeSectionView({
				path: "Note.md",
				mode: "preview",
				cursorLine: 3,
				value: BODY,
			}),
		});
		const f = new CompleteFormatter(app as any, makePlugin() as any);
		await expect(f.formatFileContent("{{linksection}}")).resolves.toBe(
			"[[Note]]",
		);
	});

	it("falls back when the active view is a different file", async () => {
		const app = makeSectionApp({
			view: makeSectionView({ path: "Other.md", cursorLine: 3, value: BODY }),
		});
		const f = new CompleteFormatter(app as any, makePlugin() as any);
		await expect(f.formatFileContent("{{linksection}}")).resolves.toBe(
			"[[Note]]",
		);
	});

	it("falls back when there is no active markdown view", async () => {
		const app = makeSectionApp({ view: undefined });
		const f = new CompleteFormatter(app as any, makePlugin() as any);
		await expect(f.formatFileContent("{{linksection}}")).resolves.toBe(
			"[[Note]]",
		);
	});

	it("falls back (never throws) if heading resolution errors", async () => {
		const app = makeSectionApp({
			view: makeSectionView({
				path: "Note.md",
				cursorLine: 3,
				getValueThrows: true,
			}),
		});
		const f = new CompleteFormatter(app as any, makePlugin() as any);
		await expect(f.formatFileContent("{{linksection}}")).resolves.toBe(
			"[[Note]]",
		);
	});

	it("throws (required) when there is no active file", async () => {
		const app = makeSectionApp({ activeFile: null, view: undefined });
		const f = new CompleteFormatter(app as any, makePlugin() as any);
		await expect(f.formatFileContent("{{linksection}}")).rejects.toThrow(
			"Unable to get current file path",
		);
	});

	// Pathological: a file literally named like a token. The link tokens are
	// resolved in a single pass so neither re-scans the other's generated link.
	it("does not re-scan a generated {{linkcurrent}} link as a section token", async () => {
		const app = makeSectionApp({
			activeFile: { basename: "{{linksection}}", path: "{{linksection}}.md" },
			view: undefined,
		});
		const f = new CompleteFormatter(app as any, makePlugin() as any);
		await expect(f.formatFileContent("{{linkcurrent}}")).resolves.toBe(
			"[[{{linksection}}]]",
		);
	});

	it("does not re-scan a generated {{linksection}} link as a linkcurrent token", async () => {
		const app = makeSectionApp({
			activeFile: { basename: "{{linkcurrent}}", path: "{{linkcurrent}}.md" },
			view: undefined,
		});
		const f = new CompleteFormatter(app as any, makePlugin() as any);
		await expect(f.formatFileContent("{{linksection}}")).resolves.toBe(
			"[[{{linkcurrent}}]]",
		);
	});
});

describe("CompleteFormatter - remote prompt provider routing", () => {
	// An interactive run driven by a remote provider (Raycast): token prompts the
	// requirement collector didn't pre-satisfy must go to the provider, not a modal.
	const providerFormatter = (
		provider: Record<string, unknown>,
		variables: Map<string, unknown> = new Map(),
	) => {
		const app = makeApp({ activeFile: null, selection: null, generatedLink: "" });
		const plugin = makePlugin({});
		return new CompleteFormatter(app as any, plugin as any, {
			variables,
			interactive: true,
			promptProvider: provider,
			execute: vi.fn(),
		} as any);
	};

	it("routes {{VALUE:opts}} to the provider's suggester, not the Obsidian modal", async () => {
		mocks.genericSuggesterSuggest.mockResolvedValue("a"); // modal answer (should be unused)
		const suggester = vi.fn(async () => "b");
		const f = providerFormatter({ suggester });
		await expect(f.formatFolderPath("{{VALUE:a,b,c}}")).resolves.toBe("b");
		expect(suggester).toHaveBeenCalledWith(
			["a", "b", "c"],
			["a", "b", "c"],
			undefined,
			false,
		);
		expect(mocks.genericSuggesterSuggest).not.toHaveBeenCalled();
	});

	it("routes anonymous {{VALUE}} to the provider's inputPrompt", async () => {
		mocks.inputPromptPrompt.mockResolvedValue("modal");
		const inputPrompt = vi.fn(async () => "remote");
		const f = providerFormatter({ inputPrompt });
		await expect(f.formatFolderPath("{{VALUE}}")).resolves.toBe("remote");
		expect(inputPrompt).toHaveBeenCalled();
		expect(mocks.inputPromptPrompt).not.toHaveBeenCalled();
	});

	it("routes named {{VALUE:name}} to the provider's inputPrompt", async () => {
		mocks.inputPromptPrompt.mockResolvedValue("modal");
		const inputPrompt = vi.fn(async () => "remote-name");
		const f = providerFormatter({ inputPrompt });
		await expect(f.formatFolderPath("{{VALUE:name}}")).resolves.toBe(
			"remote-name",
		);
		expect(inputPrompt).toHaveBeenCalled();
		expect(mocks.inputPromptPrompt).not.toHaveBeenCalled();
	});

	it("routes {{VALUE:a,b,c|multi}} to the provider's suggesterMulti, not the Obsidian modal", async () => {
		const suggesterMulti = vi.fn(
			async (_display: string[], _actual: string[]) => ["a", "c"],
		);
		const f = providerFormatter({ suggesterMulti });
		const out = await f.formatFileContent("{{VALUE:a,b,c|multi}}");
		expect(suggesterMulti).toHaveBeenCalledTimes(1);
		expect(suggesterMulti.mock.calls[0][0]).toEqual(["a", "b", "c"]);
		expect(suggesterMulti.mock.calls[0][1]).toEqual(["a", "b", "c"]);
		expect(out).toContain("a");
		expect(out).toContain("c");
	});

	it("routes anonymous {{VALUE|type:checkbox}} to the provider's suggester, not the Obsidian modal", async () => {
		mocks.genericSuggesterSuggest.mockResolvedValue("false"); // modal answer (should be unused)
		const suggester = vi.fn(async () => "true");
		const f = providerFormatter({ suggester });
		await expect(
			f.formatFileContent("[{{VALUE|type:checkbox}}]"),
		).resolves.toBe("[true]");
		expect(suggester).toHaveBeenCalledWith(
			["true", "false"],
			["true", "false"],
			expect.anything(),
			false,
		);
		expect(mocks.genericSuggesterSuggest).not.toHaveBeenCalled();
	});
});
