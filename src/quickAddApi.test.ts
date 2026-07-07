import { beforeEach, describe, expect, it, vi } from "vitest";
import type { App } from "obsidian";
import type QuickAdd from "./main";

// ---------------------------------------------------------------------------
// Hoisted mock state / spies. These back the vi.mock factories below.
// ---------------------------------------------------------------------------
const mocks = vi.hoisted(() => ({
	// GUI prompts
	genericInputPrompt: vi.fn(),
	genericWideInputPrompt: vi.fn(),
	genericYesNoPrompt: vi.fn(),
	genericInfoDialog: vi.fn(),
	genericCheckboxPrompt: vi.fn(),
	genericSuggester: vi.fn(),
	inputSuggester: vi.fn(),
	vDateInputPrompt: vi.fn(),
	onePageModalWaitForClose: vi.fn(),

	// AI
	prompt: vi.fn(),
	chunkedPrompt: vi.fn(),
	estimateTokenCount: vi.fn(),
	getAIRequestLogEntries: vi.fn(),
	getAIRequestLogEntryById: vi.fn(),
	getLastAIRequestLogEntry: vi.fn(),
	clearAIRequestLogEntries: vi.fn(),
	getModelByName: vi.fn(),
	getModelNames: vi.fn(),
	getModelProvider: vi.fn(),
	resolveProviderApiKey: vi.fn(),

	// misc
	reportError: vi.fn(),
	getDate: vi.fn(),
	formatFileContent: vi.fn(),

	// settings store
	storeState: {
		disableOnlineFeatures: false,
		ai: { defaultSystemPrompt: "DEFAULT SYS" },
	} as { disableOnlineFeatures: boolean; ai: { defaultSystemPrompt: string } },
}));

// Capture constructor args passed to OnePageInputModal so tests can assert what
// the API forwarded (app, missing requirements, the live variables map).
const onePageModalCalls: Array<{ app: unknown; missing: unknown; variables: unknown }> = [];

vi.mock("./gui/GenericInputPrompt/GenericInputPrompt", () => ({
	default: { Prompt: mocks.genericInputPrompt },
}));
vi.mock("./gui/GenericWideInputPrompt/GenericWideInputPrompt", () => ({
	default: { Prompt: mocks.genericWideInputPrompt },
}));
vi.mock("./gui/GenericYesNoPrompt/GenericYesNoPrompt", () => ({
	default: { Prompt: mocks.genericYesNoPrompt },
}));
vi.mock("./gui/GenericInfoDialog/GenericInfoDialog", () => ({
	default: { Show: mocks.genericInfoDialog },
}));
vi.mock("./gui/GenericCheckboxPrompt/genericCheckboxPrompt", () => ({
	default: { Open: mocks.genericCheckboxPrompt },
}));
vi.mock("./gui/GenericSuggester/genericSuggester", () => ({
	default: { Suggest: mocks.genericSuggester },
}));
vi.mock("./gui/InputSuggester/inputSuggester", () => ({
	default: { Suggest: mocks.inputSuggester },
}));
vi.mock("./gui/VDateInputPrompt/VDateInputPrompt", () => ({
	default: { Prompt: mocks.vDateInputPrompt },
}));
vi.mock("./preflight/OnePageInputModal", () => ({
	OnePageInputModal: class {
		waitForClose: Promise<Record<string, string>>;
		constructor(app: unknown, missing: unknown, variables: unknown) {
			onePageModalCalls.push({ app, missing, variables });
			this.waitForClose = mocks.onePageModalWaitForClose();
		}
	},
}));

vi.mock("./ai/AIAssistant", () => ({
	Prompt: mocks.prompt,
	ChunkedPrompt: mocks.chunkedPrompt,
	getAIRequestLogEntries: mocks.getAIRequestLogEntries,
	getAIRequestLogEntryById: mocks.getAIRequestLogEntryById,
	getLastAIRequestLogEntry: mocks.getLastAIRequestLogEntry,
	clearAIRequestLogEntries: mocks.clearAIRequestLogEntries,
}));
vi.mock("./ai/tokenEstimator", () => ({
	estimateTokenCount: mocks.estimateTokenCount,
}));
vi.mock("./ai/aiHelpers", () => ({
	getModelNames: mocks.getModelNames,
	// Mirrors the real resolver's contract through the two legacy mocks the
	// tests configure per-case: resolve the model, pair it with its provider,
	// throw an actionable error when the model is unknown.
	resolveModelInputOrThrow: (input: string | { name?: string }) => {
		const name = typeof input === "string" ? input : input?.name;
		if (!name) {
			throw new Error(
				"Invalid model parameter. Expected a string or an object with a name property",
			);
		}
		const model = mocks.getModelByName(name);
		if (!model) {
			throw new Error(`Model '${name}' not found in configured providers.`);
		}
		return {
			model,
			provider: mocks.getModelProvider(name) ?? { name: "MockProvider" },
		};
	},
}));
vi.mock("./ai/providerSecrets", () => ({
	resolveProviderApiKey: mocks.resolveProviderApiKey,
}));

vi.mock("./formatters/completeFormatter", () => ({
	CompleteFormatter: class {
		formatFileContent = mocks.formatFileContent;
	},
}));

vi.mock("./settingsStore", () => ({
	settingsStore: {
		getState: () => mocks.storeState,
	},
}));

vi.mock("./utilityObsidian", () => ({
	getDate: mocks.getDate,
}));

vi.mock("./utils/errorUtils", async () => {
	// Keep the real isCancellationError so cancellation detection is exercised
	// for real, but spy on reportError so we don't hit the logging subsystem.
	// eslint-disable-next-line @typescript-eslint/consistent-type-imports
	const actual = await vi.importActual<typeof import("./utils/errorUtils")>(
		"./utils/errorUtils",
	);
	return {
		...actual,
		reportError: mocks.reportError,
	};
});

// formatISODate, normalizeDisplayItem, MacroAbortError, the FieldSuggestion*
// helpers and InlineFieldParser are intentionally left REAL: they are pure and
// deterministic, so testing the API through them validates real behavior.

const { QuickAddApi } = await import("./quickAddApi");
const { MacroAbortError } = await import("./errors/MacroAbortError");

// ---------------------------------------------------------------------------
// Test doubles for app / plugin / choiceExecutor
// ---------------------------------------------------------------------------
type FakeFile = { path: string; basename?: string };

function makeApp(overrides: Record<string, unknown> = {}) {
	return {
		workspace: {
			getActiveViewOfType: vi.fn(() => undefined),
		},
		vault: {
			getMarkdownFiles: vi.fn(() => [] as FakeFile[]),
			read: vi.fn(async () => ""),
		},
		metadataCache: {
			getFileCache: vi.fn(() => undefined),
		},
		...overrides,
	} as unknown as App;
}

function makeChoiceExecutor() {
	return {
		variables: new Map<string, unknown>(),
		execute: vi.fn(async () => {}),
		consumeAbortSignal: vi.fn(
			(): InstanceType<typeof MacroAbortError> | null => null,
		),
	};
}

function makePlugin(overrides: Record<string, unknown> = {}) {
	return {
		getChoiceByName: vi.fn(() => ({ name: "choice", id: "1" })),
		...overrides,
	} as unknown as QuickAdd;
}

function getApi(
	app = makeApp(),
	plugin = makePlugin(),
	executor = makeChoiceExecutor(),
) {
	return {
		api: QuickAddApi.GetApi(app, plugin, executor as never),
		app,
		plugin,
		executor,
	};
}

beforeEach(() => {
	vi.clearAllMocks();
	onePageModalCalls.length = 0;
	mocks.storeState.disableOnlineFeatures = false;
	mocks.storeState.ai = { defaultSystemPrompt: "DEFAULT SYS" };
});

// ===========================================================================
// Static prompt wrappers + cancellation semantics
// ===========================================================================
describe("static prompt wrappers", () => {
	const app = makeApp();

	describe("inputPrompt", () => {
		it("returns the resolved value on success", async () => {
			mocks.genericInputPrompt.mockResolvedValue("hello");
			const out = await QuickAddApi.inputPrompt(app, "Header", "ph", "val");
			expect(out).toBe("hello");
			expect(mocks.genericInputPrompt).toHaveBeenCalledWith(
				app,
				"Header",
				"ph",
				"val",
				undefined,
				undefined,
			);
		});

		it("forwards cursor placement options", async () => {
			mocks.genericInputPrompt.mockResolvedValue("hello");
			await QuickAddApi.inputPrompt(app, "Header", "ph", "val", {
				cursorAtEnd: true,
			});

			expect(mocks.genericInputPrompt).toHaveBeenCalledWith(
				app,
				"Header",
				"ph",
				"val",
				undefined,
				{ cursorAtEnd: true },
			);
		});

		it("returns undefined for a generic (non-cancellation) error", async () => {
			mocks.genericInputPrompt.mockRejectedValue(new Error("boom"));
			const out = await QuickAddApi.inputPrompt(app, "Header");
			expect(out).toBeUndefined();
		});

		it("converts a cancellation string into a MacroAbortError", async () => {
			// isCancellationError matches the literal string "No input given."
			mocks.genericInputPrompt.mockRejectedValue("No input given.");
			await expect(QuickAddApi.inputPrompt(app, "Header")).rejects.toBeInstanceOf(
				MacroAbortError,
			);
		});

		it("re-throws an existing MacroAbortError unchanged", async () => {
			const abort = new MacroAbortError("aborted");
			mocks.genericInputPrompt.mockRejectedValue(abort);
			await expect(QuickAddApi.inputPrompt(app, "Header")).rejects.toBe(abort);
		});
	});

	describe("wideInputPrompt", () => {
		it("passes args through and returns the value", async () => {
			mocks.genericWideInputPrompt.mockResolvedValue("wide");
			const out = await QuickAddApi.wideInputPrompt(app, "H", "p", "v");
			expect(out).toBe("wide");
			expect(mocks.genericWideInputPrompt).toHaveBeenCalledWith(
				app,
				"H",
				"p",
				"v",
				undefined,
				undefined,
			);
		});

		it("forwards cursor placement options", async () => {
			mocks.genericWideInputPrompt.mockResolvedValue("wide");
			await QuickAddApi.wideInputPrompt(app, "H", "p", "v", {
				cursorAtEnd: true,
			});

			expect(mocks.genericWideInputPrompt).toHaveBeenCalledWith(
				app,
				"H",
				"p",
				"v",
				undefined,
				{ cursorAtEnd: true },
			);
		});

		it("swallows generic errors as undefined", async () => {
			mocks.genericWideInputPrompt.mockRejectedValue(new Error("x"));
			expect(await QuickAddApi.wideInputPrompt(app, "H")).toBeUndefined();
		});
	});

	describe("yesNoPrompt", () => {
		it("returns the boolean answer", async () => {
			mocks.genericYesNoPrompt.mockResolvedValue(true);
			expect(await QuickAddApi.yesNoPrompt(app, "H", "txt")).toBe(true);
			expect(mocks.genericYesNoPrompt).toHaveBeenCalledWith(app, "H", "txt");
		});

		it("treats 'No answer given.' as a cancellation abort", async () => {
			mocks.genericYesNoPrompt.mockRejectedValue("No answer given.");
			await expect(QuickAddApi.yesNoPrompt(app, "H")).rejects.toBeInstanceOf(
				MacroAbortError,
			);
		});
	});

	describe("infoDialog", () => {
		it("forwards header and text and returns the result", async () => {
			mocks.genericInfoDialog.mockResolvedValue(undefined);
			await QuickAddApi.infoDialog(app, "H", ["a", "b"]);
			expect(mocks.genericInfoDialog).toHaveBeenCalledWith(app, "H", ["a", "b"]);
		});
	});

	describe("checkboxPrompt", () => {
		it("forwards items and selected items", async () => {
			mocks.genericCheckboxPrompt.mockResolvedValue(["a"]);
			const out = await QuickAddApi.checkboxPrompt(app, ["a", "b"], ["a"]);
			expect(out).toEqual(["a"]);
			expect(mocks.genericCheckboxPrompt).toHaveBeenCalledWith(
				app,
				["a", "b"],
				["a"],
			);
		});

		it("returns undefined on a generic error", async () => {
			mocks.genericCheckboxPrompt.mockRejectedValue(new Error("nope"));
			expect(await QuickAddApi.checkboxPrompt(app, [])).toBeUndefined();
		});
	});
});

// ===========================================================================
// datePrompt formatting logic
// ===========================================================================
describe("datePrompt", () => {
	const app = makeApp();

	it("returns the raw value when it has no @date: prefix", async () => {
		mocks.vDateInputPrompt.mockResolvedValue("just text");
		const out = await QuickAddApi.datePrompt(app, "Pick a date");
		expect(out).toBe("just text");
	});

	it("formats an @date: ISO value using the supplied dateFormat", async () => {
		mocks.vDateInputPrompt.mockResolvedValue("@date:2025-06-21T00:00:00.000Z");
		const out = await QuickAddApi.datePrompt(app, "Pick", {
			dateFormat: "YYYY-MM-DD",
		});
		// real formatISODate -> stub moment formats YYYY-MM-DD to "2025-06-21"
		expect(out).toBe("2025-06-21");
	});

	it("falls back to the raw ISO when no dateFormat is provided", async () => {
		mocks.vDateInputPrompt.mockResolvedValue("@date:2025-06-21T00:00:00.000Z");
		const out = await QuickAddApi.datePrompt(app, "Pick");
		expect(out).toBe("2025-06-21T00:00:00.000Z");
	});

	it("forwards placeholder, defaultValue and dateFormat to the prompt", async () => {
		mocks.vDateInputPrompt.mockResolvedValue("x");
		await QuickAddApi.datePrompt(app, "Header", {
			placeholder: "ph",
			defaultValue: "dv",
			dateFormat: "YYYY",
		});
		expect(mocks.vDateInputPrompt).toHaveBeenCalledWith(
			app,
			"Header",
			"ph",
			"dv",
			"YYYY",
		);
	});

	it("returns undefined on a generic error", async () => {
		mocks.vDateInputPrompt.mockRejectedValue(new Error("fail"));
		expect(await QuickAddApi.datePrompt(app, "H")).toBeUndefined();
	});

	it("converts a cancellation into a MacroAbortError", async () => {
		mocks.vDateInputPrompt.mockRejectedValue("No input given.");
		await expect(QuickAddApi.datePrompt(app, "H")).rejects.toBeInstanceOf(
			MacroAbortError,
		);
	});
});

// ===========================================================================
// suggester display-item normalization + routing
// ===========================================================================
describe("suggester", () => {
	const app = makeApp();

	it("maps an array of display items through normalizeDisplayItem and uses GenericSuggester", async () => {
		mocks.genericSuggester.mockResolvedValue("picked");
		const out = await QuickAddApi.suggester(
			app,
			["a", "b"],
			["valA", "valB"],
			"placeholder",
		);
		expect(out).toBe("picked");
		expect(mocks.genericSuggester).toHaveBeenCalledWith(
			app,
			["a", "b"],
			["valA", "valB"],
			"placeholder",
			undefined,
		);
		expect(mocks.inputSuggester).not.toHaveBeenCalled();
	});

	it("derives display items from a mapping function over actualItems", async () => {
		mocks.genericSuggester.mockResolvedValue("x");
		await QuickAddApi.suggester(
			app,
			(value: string, index?: number) => `${value}-${index}`,
			["one", "two"],
		);
		// display items computed from actualItems with index
		expect(mocks.genericSuggester).toHaveBeenCalledWith(
			app,
			["one-0", "two-1"],
			["one", "two"],
			undefined,
			undefined,
		);
	});

	it("normalizes non-string display values to strings", async () => {
		mocks.genericSuggester.mockResolvedValue("x");
		await QuickAddApi.suggester(
			app,
			[1 as unknown as string, null as unknown as string, "c"],
			["a", "b", "c"],
		);
		expect(mocks.genericSuggester).toHaveBeenCalledWith(
			app,
			["1", "", "c"],
			["a", "b", "c"],
			undefined,
			undefined,
		);
	});

	it("routes to InputSuggester when allowCustomInput is true", async () => {
		mocks.inputSuggester.mockResolvedValue("custom");
		const out = await QuickAddApi.suggester(
			app,
			["a"],
			["a"],
			"ph",
			true,
		);
		expect(out).toBe("custom");
		expect(mocks.inputSuggester).toHaveBeenCalledWith(app, ["a"], ["a"], {
			placeholder: "ph",
		});
		expect(mocks.genericSuggester).not.toHaveBeenCalled();
	});

	it("omits placeholder key for InputSuggester when none is given but includes renderItem", async () => {
		mocks.inputSuggester.mockResolvedValue("custom");
		const renderItem = vi.fn();
		await QuickAddApi.suggester(app, ["a"], ["a"], undefined, true, {
			renderItem,
		});
		expect(mocks.inputSuggester).toHaveBeenCalledWith(app, ["a"], ["a"], {
			renderItem,
		});
	});

	it("returns undefined on a generic error", async () => {
		mocks.genericSuggester.mockRejectedValue(new Error("boom"));
		expect(await QuickAddApi.suggester(app, ["a"], ["a"])).toBeUndefined();
	});
});

// ===========================================================================
// GetApi() thin wrappers delegate to the static methods
// ===========================================================================
describe("GetApi prompt wrappers", () => {
	it("inputPrompt delegates with app/header/placeholder/value", async () => {
		mocks.genericInputPrompt.mockResolvedValue("v");
		const { api, app } = getApi();
		const out = await api.inputPrompt("H", "p", "val");
		expect(out).toBe("v");
		expect(mocks.genericInputPrompt).toHaveBeenCalledWith(
			app,
			"H",
			"p",
			"val",
			undefined,
			undefined,
		);
	});

	it("inputPrompt delegates cursor placement options", async () => {
		mocks.genericInputPrompt.mockResolvedValue("v");
		const { api, app } = getApi();
		await api.inputPrompt("H", "p", "val", { cursorAtEnd: true });
		expect(mocks.genericInputPrompt).toHaveBeenCalledWith(
			app,
			"H",
			"p",
			"val",
			undefined,
			{ cursorAtEnd: true },
		);
	});

	it("wideInputPrompt delegates cursor placement options", async () => {
		mocks.genericWideInputPrompt.mockResolvedValue("v");
		const { api, app } = getApi();
		await api.wideInputPrompt("H", "p", "val", {
			cursorAtEnd: true,
		});
		expect(mocks.genericWideInputPrompt).toHaveBeenCalledWith(
			app,
			"H",
			"p",
			"val",
			undefined,
			{ cursorAtEnd: true },
		);
	});

	it("suggester delegates options through", async () => {
		mocks.genericSuggester.mockResolvedValue("v");
		const { api, app } = getApi();
		await api.suggester(["d"], ["a"], "ph");
		expect(mocks.genericSuggester).toHaveBeenCalledWith(
			app,
			["d"],
			["a"],
			"ph",
			undefined,
		);
	});
});

// ===========================================================================
// date helpers delegate to getDate with the right offset
// ===========================================================================
describe("date helpers", () => {
	it("now() forwards format and offset", () => {
		mocks.getDate.mockReturnValue("NOW");
		const { api } = getApi();
		expect(api.date.now("YYYY", 3)).toBe("NOW");
		expect(mocks.getDate).toHaveBeenCalledWith({ format: "YYYY", offset: 3 });
	});

	it("tomorrow() uses offset 1", () => {
		mocks.getDate.mockReturnValue("T");
		const { api } = getApi();
		api.date.tomorrow("YYYY-MM-DD");
		expect(mocks.getDate).toHaveBeenCalledWith({
			format: "YYYY-MM-DD",
			offset: 1,
		});
	});

	it("yesterday() uses offset -1", () => {
		mocks.getDate.mockReturnValue("Y");
		const { api } = getApi();
		api.date.yesterday();
		expect(mocks.getDate).toHaveBeenCalledWith({
			format: undefined,
			offset: -1,
		});
	});
});

// ===========================================================================
// utility.getSelection / getSelectedText
// ===========================================================================
describe("utility selection helpers", () => {
	it("getSelection returns empty string when no active markdown view", () => {
		const { api } = getApi();
		expect(api.utility.getSelection()).toBe("");
	});

	it("getSelection returns the editor selection when a view is active", () => {
		const app = makeApp({
			workspace: {
				getActiveViewOfType: () => ({
					editor: { getSelection: () => "selected text" },
				}),
			},
		});
		const { api } = getApi(app);
		expect(api.utility.getSelection()).toBe("selected text");
	});

	it("getSelection coerces a null editor selection to empty string", () => {
		const app = makeApp({
			workspace: {
				getActiveViewOfType: () => ({
					editor: { getSelection: () => null },
				}),
			},
		});
		const { api } = getApi(app);
		expect(api.utility.getSelection()).toBe("");
	});

	it("getSelectedText reports an error and returns '' with no view", () => {
		const { api } = getApi();
		expect(api.utility.getSelectedText()).toBe("");
		expect(mocks.reportError).toHaveBeenCalled();
	});

	it("getSelectedText reports an error when nothing is selected", () => {
		const app = makeApp({
			workspace: {
				getActiveViewOfType: () => ({
					editor: {
						somethingSelected: () => false,
						getSelection: () => "",
					},
				}),
			},
		});
		const { api } = getApi(app);
		expect(api.utility.getSelectedText()).toBe("");
		expect(mocks.reportError).toHaveBeenCalled();
	});

	it("getSelectedText returns the selection when something is selected", () => {
		const app = makeApp({
			workspace: {
				getActiveViewOfType: () => ({
					editor: {
						somethingSelected: () => true,
						getSelection: () => "the text",
					},
				}),
			},
		});
		const { api } = getApi(app);
		expect(api.utility.getSelectedText()).toBe("the text");
		expect(mocks.reportError).not.toHaveBeenCalled();
	});
});

// ===========================================================================
// AI sync helpers (getModels / getMaxTokens / estimateTokens / countTokens / logs)
// ===========================================================================
describe("ai sync helpers", () => {
	it("getModels delegates to getModelNames", () => {
		mocks.getModelNames.mockReturnValue(["a", "b"]);
		const { api } = getApi();
		expect(api.ai.getModels()).toEqual(["a", "b"]);
	});

	it("getMaxTokens returns the model maxTokens", () => {
		mocks.getModelByName.mockReturnValue({ name: "m", maxTokens: 4096 });
		const { api } = getApi();
		expect(api.ai.getMaxTokens("m")).toBe(4096);
	});

	it("getMaxTokens throws when the model is unknown", () => {
		mocks.getModelByName.mockReturnValue(undefined);
		const { api } = getApi();
		expect(() => api.ai.getMaxTokens("nope")).toThrow(
			"not found in configured providers",
		);
	});

	it("estimateTokens delegates to the provider-agnostic estimator", () => {
		mocks.estimateTokenCount.mockReturnValue(5);
		const { api } = getApi();
		expect(api.ai.estimateTokens("hi")).toBe(5);
		expect(mocks.estimateTokenCount).toHaveBeenCalledWith("hi");
	});

	it("countTokens is a compatibility alias that ignores the model arg", () => {
		mocks.estimateTokenCount.mockReturnValue(7);
		const { api } = getApi();
		const model = { name: "m", maxTokens: 1 } as never;
		expect(api.ai.countTokens("hi", model)).toBe(7);
		expect(mocks.estimateTokenCount).toHaveBeenCalledWith("hi");
	});

	it("getRequestLogs delegates with a default limit of 10", () => {
		mocks.getAIRequestLogEntries.mockReturnValue([]);
		const { api } = getApi();
		api.ai.getRequestLogs();
		expect(mocks.getAIRequestLogEntries).toHaveBeenCalledWith(10);
	});

	it("getRequestLogs forwards an explicit limit", () => {
		mocks.getAIRequestLogEntries.mockReturnValue([]);
		const { api } = getApi();
		api.ai.getRequestLogs(3);
		expect(mocks.getAIRequestLogEntries).toHaveBeenCalledWith(3);
	});

	it("getRequestLogById delegates", () => {
		mocks.getAIRequestLogEntryById.mockReturnValue({ id: "x" });
		const { api } = getApi();
		expect(api.ai.getRequestLogById("x")).toEqual({ id: "x" });
		expect(mocks.getAIRequestLogEntryById).toHaveBeenCalledWith("x");
	});

	it("getLastRequestLog delegates", () => {
		mocks.getLastAIRequestLogEntry.mockReturnValue({ id: "last" });
		const { api } = getApi();
		expect(api.ai.getLastRequestLog()).toEqual({ id: "last" });
	});

	it("clearRequestLogs delegates", () => {
		const { api } = getApi();
		api.ai.clearRequestLogs();
		expect(mocks.clearAIRequestLogEntries).toHaveBeenCalled();
	});
});

// ===========================================================================
// AI prompt: pre-flight validation branches (no network)
// ===========================================================================
describe("ai.prompt validation", () => {
	it("rejects when online features are disabled", async () => {
		mocks.storeState.disableOnlineFeatures = true;
		const { api } = getApi();
		await expect(api.ai.prompt("hi", "gpt-4")).rejects.toThrow(
			"Online features are disabled",
		);
	});

	it("throws for an empty model string", async () => {
		const { api } = getApi();
		await expect(api.ai.prompt("hi", "")).rejects.toThrow(
			"Invalid model parameter",
		);
	});

	it("throws for a model object without a name", async () => {
		const { api } = getApi();
		await expect(
			api.ai.prompt("hi", {} as never),
		).rejects.toThrow("Invalid model parameter");
	});

	it("throws when the model is not found in configured providers", async () => {
		mocks.getModelByName.mockReturnValue(undefined);
		const { api } = getApi();
		await expect(api.ai.prompt("hi", "gpt-4")).rejects.toThrow(
			"not found in configured providers",
		);
	});

	it("invokes Prompt with resolved key/model and assigns variables when requested", async () => {
		mocks.getModelByName.mockReturnValue({ name: "gpt-4", maxTokens: 1 });
		mocks.getModelProvider.mockReturnValue({ name: "OpenAI" });
		mocks.resolveProviderApiKey.mockResolvedValue("KEY");
		mocks.prompt.mockResolvedValue({ output: "result", "output-quoted": "> result" });

		const executor = makeChoiceExecutor();
		const { api } = getApi(makeApp(), makePlugin(), executor);

		const res = await api.ai.prompt("Question?", "gpt-4", {
			shouldAssignVariables: true,
			variableName: "answer",
			systemPrompt: "SYS",
		});

		expect(res).toEqual({ output: "result", "output-quoted": "> result" });
		expect(mocks.resolveProviderApiKey).toHaveBeenCalledWith(
			expect.anything(),
			{ name: "OpenAI" },
		);
		// The options object passed to Prompt reflects our overrides.
		const passedOptions = mocks.prompt.mock.calls[0][1];
		expect(passedOptions).toMatchObject({
			prompt: "Question?",
			apiKey: "KEY",
			outputVariableName: "answer",
			systemPrompt: "SYS",
		});
		// shouldAssignVariables copies results into the executor's variable map.
		expect(executor.variables.get("output")).toBe("result");
		expect(executor.variables.get("output-quoted")).toBe("> result");
	});

	it("uses default outputVariableName and system prompt when not provided", async () => {
		mocks.getModelByName.mockReturnValue({ name: "gpt-4", maxTokens: 1 });
		mocks.getModelProvider.mockReturnValue({ name: "OpenAI" });
		mocks.resolveProviderApiKey.mockResolvedValue("KEY");
		mocks.prompt.mockResolvedValue({ output: "r" });
		const { api } = getApi();
		await api.ai.prompt("q", "gpt-4");
		const passedOptions = mocks.prompt.mock.calls[0][1];
		expect(passedOptions).toMatchObject({
			outputVariableName: "output",
			systemPrompt: "DEFAULT SYS",
			showAssistantMessages: true,
		});
	});

	it("returns {} and reports error when Prompt resolves null", async () => {
		mocks.getModelByName.mockReturnValue({ name: "gpt-4", maxTokens: 1 });
		mocks.getModelProvider.mockReturnValue({ name: "OpenAI" });
		mocks.resolveProviderApiKey.mockResolvedValue("KEY");
		mocks.prompt.mockResolvedValue(null);
		const { api } = getApi();
		const res = await api.ai.prompt("q", "gpt-4");
		expect(res).toEqual({});
		expect(mocks.reportError).toHaveBeenCalled();
	});
});

// ===========================================================================
// AI chunkedPrompt: pre-flight validation branches (no network)
// ===========================================================================
describe("ai.chunkedPrompt validation", () => {
	it("rejects when online features are disabled", async () => {
		mocks.storeState.disableOnlineFeatures = true;
		const { api } = getApi();
		await expect(
			api.ai.chunkedPrompt("text", "tmpl", "gpt-4"),
		).rejects.toThrow("Online features are disabled");
	});

	it("throws for a missing model name", async () => {
		const { api } = getApi();
		await expect(
			api.ai.chunkedPrompt("text", "tmpl", "" as never),
		).rejects.toThrow("Invalid model parameter");
	});

	it("throws when the model is not found", async () => {
		mocks.getModelByName.mockReturnValue(undefined);
		const { api } = getApi();
		await expect(
			api.ai.chunkedPrompt("text", "tmpl", "gpt-4"),
		).rejects.toThrow("not found in configured providers");
	});

	it("passes default chunkSeparator/joiner/shouldMerge to ChunkedPrompt", async () => {
		mocks.getModelByName.mockReturnValue({ name: "gpt-4", maxTokens: 1 });
		mocks.getModelProvider.mockReturnValue({ name: "OpenAI" });
		mocks.resolveProviderApiKey.mockResolvedValue("KEY");
		mocks.chunkedPrompt.mockResolvedValue({ output: "ok" });
		const { api } = getApi();
		await api.ai.chunkedPrompt("text", "tmpl", "gpt-4");
		const opts = mocks.chunkedPrompt.mock.calls[0][1];
		expect(opts).toMatchObject({
			text: "text",
			promptTemplate: "tmpl",
			resultJoiner: "\n",
			shouldMerge: true,
			maxChunkTokens: undefined,
		});
		expect(opts.chunkSeparator).toBeInstanceOf(RegExp);
	});

	it("returns {} and reports error when ChunkedPrompt resolves null", async () => {
		mocks.getModelByName.mockReturnValue({ name: "gpt-4", maxTokens: 1 });
		mocks.getModelProvider.mockReturnValue({ name: "OpenAI" });
		mocks.resolveProviderApiKey.mockResolvedValue("KEY");
		mocks.chunkedPrompt.mockResolvedValue(null);
		const { api } = getApi();
		expect(await api.ai.chunkedPrompt("t", "tmpl", "gpt-4")).toEqual({});
		expect(mocks.reportError).toHaveBeenCalled();
	});
});

// ===========================================================================
// executeChoice
// ===========================================================================
describe("executeChoice", () => {
	it("looks up the choice, sets variables, and executes it", async () => {
		const choice = { name: "MyChoice", id: "id1" };
		const executor = makeChoiceExecutor();
		const plugin = makePlugin({ getChoiceByName: vi.fn(() => choice) });
		const { api } = getApi(makeApp(), plugin, executor);

		await api.executeChoice("MyChoice", { foo: "bar" });

		expect(plugin.getChoiceByName).toHaveBeenCalledWith("MyChoice");
		expect(executor.execute).toHaveBeenCalledWith(choice);
		// Variables are cleared after execution.
		expect(executor.variables.size).toBe(0);
	});

	it("reports an error when the choice is not found", async () => {
		const plugin = makePlugin({ getChoiceByName: vi.fn(() => undefined) });
		const executor = makeChoiceExecutor();
		const { api } = getApi(makeApp(), plugin, executor);
		await api.executeChoice("Missing");
		expect(mocks.reportError).toHaveBeenCalled();
	});

	it("throws the abort signal when the executor reports one", async () => {
		const abort = new MacroAbortError("stop");
		const executor = makeChoiceExecutor();
		executor.consumeAbortSignal = vi.fn(
			(): InstanceType<typeof MacroAbortError> | null => abort,
		);
		const { api } = getApi(makeApp(), makePlugin(), executor);
		await expect(api.executeChoice("C")).rejects.toBe(abort);
		// Variables are still cleared even when aborting.
		expect(executor.variables.size).toBe(0);
	});

	it("works when no variables are provided", async () => {
		const executor = makeChoiceExecutor();
		const { api } = getApi(makeApp(), makePlugin(), executor);
		await api.executeChoice("C");
		expect(executor.execute).toHaveBeenCalled();
	});
});

// ===========================================================================
// format() variable snapshot/restore
// ===========================================================================
describe("format", () => {
	it("formats the input via CompleteFormatter and returns the result", async () => {
		mocks.formatFileContent.mockResolvedValue("formatted");
		const { api } = getApi();
		expect(await api.format("input")).toBe("formatted");
		expect(mocks.formatFileContent).toHaveBeenCalledWith("input");
	});

	it("restores the original variables after formatting by default", async () => {
		mocks.formatFileContent.mockResolvedValue("out");
		const executor = makeChoiceExecutor();
		executor.variables.set("pre", "existing");
		const { api } = getApi(makeApp(), makePlugin(), executor);

		await api.format("in", { temp: "value" });

		// The temporary variable must NOT leak; the original snapshot is restored.
		expect(executor.variables.get("pre")).toBe("existing");
		expect(executor.variables.has("temp")).toBe(false);
	});

	it("keeps injected variables when shouldClearVariables is false", async () => {
		mocks.formatFileContent.mockResolvedValue("out");
		const executor = makeChoiceExecutor();
		const { api } = getApi(makeApp(), makePlugin(), executor);

		await api.format("in", { keep: "me" }, false);

		expect(executor.variables.get("keep")).toBe("me");
	});
});

// ===========================================================================
// requestInputs
// ===========================================================================
describe("requestInputs", () => {
	it("returns existing values immediately without opening the modal", async () => {
		const executor = makeChoiceExecutor();
		executor.variables.set("project", "Inbox");
		const { api } = getApi(makeApp(), makePlugin(), executor);

		const result = await api.requestInputs([
			{ id: "project", type: "text" },
		]);

		expect(result).toEqual({ project: "Inbox" });
		expect(onePageModalCalls.length).toBe(0);
	});

	it("treats an empty-string variable as intentional and does not re-ask", async () => {
		const executor = makeChoiceExecutor();
		executor.variables.set("note", "");
		const { api } = getApi(makeApp(), makePlugin(), executor);

		const result = await api.requestInputs([{ id: "note", type: "text" }]);

		expect(result).toEqual({ note: "" });
		expect(onePageModalCalls.length).toBe(0);
	});

	it("opens the modal for missing inputs and merges collected values", async () => {
		mocks.onePageModalWaitForClose.mockResolvedValue({ name: "Alice" });
		const executor = makeChoiceExecutor();
		executor.variables.set("known", "yes");
		const { api } = getApi(makeApp(), makePlugin(), executor);

		const result = await api.requestInputs([
			{ id: "known", type: "text" },
			{ id: "name", label: "Name", type: "text" },
		]);

		expect(result).toEqual({ known: "yes", name: "Alice" });
		// Only the missing field is forwarded to the modal.
		expect(onePageModalCalls.length).toBe(1);
		const missing = onePageModalCalls[0].missing as Array<{ id: string; label: string }>;
		expect(missing).toHaveLength(1);
		expect(missing[0]).toMatchObject({
			id: "name",
			label: "Name",
			source: "script",
		});
		// Raw values are written back to the live variable map.
		expect(executor.variables.get("name")).toBe("Alice");
	});

	it("defaults a missing label to the field id", async () => {
		mocks.onePageModalWaitForClose.mockResolvedValue({ city: "Oslo" });
		const { api } = getApi();
		await api.requestInputs([{ id: "city", type: "text" }]);
		const missing = onePageModalCalls[0].missing as Array<{ label: string }>;
		expect(missing[0].label).toBe("city");
	});

	it("forwards number and slider input metadata to the one-page modal", async () => {
		mocks.onePageModalWaitForClose.mockResolvedValue({
			rating: "5",
			confidence: "80",
		});
		const { api } = getApi();

		await api.requestInputs([
			{
				id: "rating",
				type: "number",
				numericConfig: { min: 1, max: 10, step: 1 },
			},
			{
				id: "confidence",
				type: "slider",
				sliderConfig: { min: 0, max: 100, step: 5 },
			},
		]);

		const missing = onePageModalCalls[0].missing as Array<{
			id: string;
			type: string;
			numericConfig?: unknown;
			sliderConfig?: unknown;
		}>;
		expect(missing).toEqual([
			expect.objectContaining({
				id: "rating",
				type: "number",
				numericConfig: { min: 1, max: 10, step: 1 },
			}),
			expect.objectContaining({
				id: "confidence",
				type: "slider",
				numericConfig: { min: 0, max: 100, step: 5 },
				sliderConfig: { min: 0, max: 100, step: 5 },
			}),
		]);
	});

	it("downgrades requestInputs sliders without valid config to number", async () => {
		mocks.onePageModalWaitForClose.mockResolvedValue({ confidence: "80" });
		const { api } = getApi();

		await api.requestInputs([
			{ id: "confidence", type: "slider" } as {
				id: string;
				type: "slider";
			},
		]);

		const missing = onePageModalCalls[0].missing as Array<{
			type: string;
			sliderConfig?: unknown;
		}>;
		expect(missing[0]).toMatchObject({
			type: "number",
			sliderConfig: undefined,
		});
	});

	it("formats a date field that returns an @date: value using dateFormat", async () => {
		mocks.onePageModalWaitForClose.mockResolvedValue({
			due: "@date:2025-06-21T00:00:00.000Z",
		});
		const executor = makeChoiceExecutor();
		const { api } = getApi(makeApp(), makePlugin(), executor);

		const result = await api.requestInputs([
			{ id: "due", type: "date", dateFormat: "YYYY-MM-DD" },
		]);

		// User-friendly value is formatted...
		expect(result.due).toBe("2025-06-21");
		// ...but the raw @date: value is stored for downstream processors.
		expect(executor.variables.get("due")).toBe("@date:2025-06-21T00:00:00.000Z");
	});

	it("propagates a MacroAbortError when the modal is cancelled", async () => {
		mocks.onePageModalWaitForClose.mockRejectedValue("cancelled");
		const { api } = getApi();
		await expect(
			api.requestInputs([{ id: "x", type: "text" }]),
		).rejects.toBeInstanceOf(MacroAbortError);
	});
});

// ===========================================================================
// fieldSuggestions
// ===========================================================================
describe("fieldSuggestions.getFieldValues", () => {
	function fileCacheApp(
		frontmatterByPath: Record<string, Record<string, unknown>>,
		contentByPath: Record<string, string> = {},
	) {
		const files = Object.keys(frontmatterByPath).map((path) => ({ path }));
		return makeApp({
			vault: {
				getMarkdownFiles: () => files,
				read: async (file: FakeFile) => contentByPath[file.path] ?? "",
			},
			metadataCache: {
				getFileCache: (file: FakeFile) => ({
					frontmatter: frontmatterByPath[file.path],
				}),
			},
		});
	}

	it("collects, de-duplicates and sorts frontmatter scalar values", async () => {
		const app = fileCacheApp({
			"a.md": { status: "done" },
			"b.md": { status: "todo" },
			"c.md": { status: "done" },
		});
		const { api } = getApi(app);
		const values = await api.fieldSuggestions.getFieldValues("status");
		expect(values).toEqual(["done", "todo"]);
	});

	it("expands array frontmatter values and trims whitespace", async () => {
		const app = fileCacheApp({
			"a.md": { tags: ["  one ", "two", ""] },
		});
		const { api } = getApi(app);
		const values = await api.fieldSuggestions.getFieldValues("tags");
		expect(values).toEqual(["one", "two"]);
	});

	it("ignores object-valued frontmatter and missing fields", async () => {
		const app = fileCacheApp({
			"a.md": { meta: { nested: true } },
			"b.md": { other: "x" },
		});
		const { api } = getApi(app);
		const values = await api.fieldSuggestions.getFieldValues("meta");
		expect(values).toEqual([]);
	});

	it("reads inline field values when includeInline is true", async () => {
		const app = fileCacheApp(
			{ "a.md": {} },
			{ "a.md": "priority:: high\npriority:: low\n" },
		);
		const { api } = getApi(app);
		const values = await api.fieldSuggestions.getFieldValues("priority", {
			includeInline: true,
		});
		expect(values).toEqual(["high", "low"]);
	});

	it("does not read file contents when includeInline is false", async () => {
		const readSpy = vi.fn(async () => "priority:: high\n");
		const app = makeApp({
			vault: {
				getMarkdownFiles: () => [{ path: "a.md" }],
				read: readSpy,
			},
			metadataCache: { getFileCache: () => ({ frontmatter: {} }) },
		});
		const { api } = getApi(app);
		await api.fieldSuggestions.getFieldValues("priority");
		expect(readSpy).not.toHaveBeenCalled();
	});

	it("returns an empty array when there are no files", async () => {
		const { api } = getApi(makeApp());
		expect(await api.fieldSuggestions.getFieldValues("anything")).toEqual([]);
	});
});

describe("fieldSuggestions.clearCache", () => {
	it("delegates to the FieldSuggestionCache singleton without throwing", () => {
		const { api } = getApi();
		expect(() => api.fieldSuggestions.clearCache()).not.toThrow();
		expect(() => api.fieldSuggestions.clearCache("status")).not.toThrow();
	});
});
