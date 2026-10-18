import { createChoiceExecutor } from "../tests/helpers/createChoiceExecutor";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { App } from "obsidian";
import type QuickAdd from "./main";
import type { MacroAbortError } from "./errors/MacroAbortError";

// ---------------------------------------------------------------------------
// Minimal hoisted mocks. We keep the AI/format/settings subsystems stubbed out
// so importing quickAddApi stays cheap; only reportError is spied so we can
// assert the documented "report + continue" behaviour.
// ---------------------------------------------------------------------------
const mocks = vi.hoisted(() => ({
	reportError: vi.fn(),
}));

vi.mock("./gui/GenericInputPrompt/GenericInputPrompt", () => ({
	default: { Prompt: vi.fn() },
}));
vi.mock("./gui/GenericWideInputPrompt/GenericWideInputPrompt", () => ({
	default: { Prompt: vi.fn() },
}));
vi.mock("./gui/GenericYesNoPrompt/GenericYesNoPrompt", () => ({
	default: { Ask: vi.fn(), Prompt: vi.fn() },
}));
vi.mock("./gui/GenericInfoDialog/GenericInfoDialog", () => ({
	default: { Show: vi.fn() },
}));
vi.mock("./gui/GenericCheckboxPrompt/genericCheckboxPrompt", () => ({
	default: { Open: vi.fn() },
}));
vi.mock("./gui/GenericSuggester/genericSuggester", () => ({
	default: { Suggest: vi.fn() },
}));
vi.mock("./gui/InputSuggester/inputSuggester", () => ({
	default: { Suggest: vi.fn() },
}));
vi.mock("./gui/VDateInputPrompt/VDateInputPrompt", () => ({
	default: { Prompt: vi.fn() },
}));
vi.mock("./preflight/OnePageInputModal", () => ({
	OnePageInputModal: class {},
}));
vi.mock("./ai/AIAssistant", () => ({
	Prompt: vi.fn(),
	ChunkedPrompt: vi.fn(),
	getAIRequestLogEntries: vi.fn(),
	getAIRequestLogEntryById: vi.fn(),
	getLastAIRequestLogEntry: vi.fn(),
	clearAIRequestLogEntries: vi.fn(),
}));
vi.mock("./ai/tokenEstimator", () => ({ estimateTokenCount: vi.fn() }));
vi.mock("./ai/aiHelpers", () => ({
	getModelByName: vi.fn(),
	getModelNames: vi.fn(),
	getModelProvider: vi.fn(),
}));
vi.mock("./ai/providerSecrets", () => ({ resolveProviderApiKey: vi.fn() }));
vi.mock("./formatters/completeFormatter", () => ({
	CompleteFormatter: class {
		formatFileContent = vi.fn();
	},
}));
vi.mock("./settingsStore", () => ({
	settingsStore: {
		getState: () => ({
			disableOnlineFeatures: false,
			ai: { defaultSystemPrompt: "DEFAULT SYS" },
		}),
	},
}));
vi.mock("./utils/dates", () => ({
	getDate: vi.fn(),
}));
vi.mock("./utils/errorUtils", async () => {
	// eslint-disable-next-line @typescript-eslint/consistent-type-imports
	const actual = await vi.importActual<typeof import("./utils/errorUtils")>(
		"./utils/errorUtils",
	);
	return { ...actual, reportError: mocks.reportError };
});

const { QuickAddApi } = await import("./quickAddApi");

type FakeFile = { path: string; basename?: string };

function makeApp(overrides: Record<string, unknown> = {}) {
	return {
		workspace: { getActiveViewOfType: vi.fn(() => undefined) },
		vault: {
			getMarkdownFiles: vi.fn(() => [] as FakeFile[]),
			read: vi.fn(async () => ""),
		},
		metadataCache: { getFileCache: vi.fn(() => undefined) },
		...overrides,
	} as unknown as App;
}

function makeChoiceExecutor() {
	return {
		...createChoiceExecutor(),
		variables: new Map<string, unknown>(),
		execute: vi.fn(async () => {}),
		consumeAbortSignal: vi.fn((): MacroAbortError | null => null),
	};
}

function makePlugin(choices: unknown[] = []) {
	return { settings: { choices } } as unknown as QuickAdd;
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
});

// ===========================================================================
// executeChoice on a name no choice has.
// (audit: api-execute-choice)
// ===========================================================================
describe("executeChoice on an unknown choice", () => {
	it("reports the error and returns instead of throwing", async () => {
		const executor = makeChoiceExecutor();
		const { api } = getApi(makeApp(), makePlugin(), executor);

		await expect(api.executeChoice("typo")).resolves.toBeUndefined();
		expect(mocks.reportError).toHaveBeenCalled();
		// The macro is NOT aborted: execute() is never reached, no throw escapes.
		expect(executor.execute).not.toHaveBeenCalled();
	});

	it("still executes a found choice and clears variables", async () => {
		const choice = { name: "MyChoice", id: "id1", type: "Template", command: false };
		const executor = makeChoiceExecutor();
		const { api } = getApi(makeApp(), makePlugin([choice]), executor);

		await api.executeChoice("MyChoice", { foo: "bar" });

		expect(executor.execute).toHaveBeenCalledWith(choice, undefined);
		expect(executor.variables.size).toBe(0);
		expect(mocks.reportError).not.toHaveBeenCalled();
	});
});

// ===========================================================================
// fieldSuggestions.getFieldValues — null/object array items + unreadable files.
// (audit: api-field-suggestions-get-field-values / integrations-api-getfieldvalues)
// ===========================================================================
describe("getFieldValues frontmatter array safety", () => {
	function fileCacheApp(
		frontmatterByPath: Record<string, Record<string, unknown>>,
		read?: (file: FakeFile) => Promise<string>,
	) {
		const files = Object.keys(frontmatterByPath).map((path) => ({ path }));
		return makeApp({
			vault: {
				getMarkdownFiles: () => files,
				cachedRead: read ?? (async () => ""),
			},
			metadataCache: {
				getFileCache: (file: FakeFile) => ({
					frontmatter: frontmatterByPath[file.path],
				}),
			},
		});
	}

	it("skips null array items instead of throwing on .toString()", async () => {
		// `tags:\n  - done\n  -\n  - pending` parses to ["done", null, "pending"].
		const app = fileCacheApp({
			"a.md": { tags: ["done", null, "pending"] },
		});
		const { api } = getApi(app);

		const values = await api.fieldSuggestions.getFieldValues("tags");
		expect(values).toEqual(["done", "pending"]);
	});

	it("ignores object array items instead of emitting [object Object]", async () => {
		const app = fileCacheApp({
			"a.md": { tags: ["ok", { nested: true }] },
		});
		const { api } = getApi(app);

		const values = await api.fieldSuggestions.getFieldValues("tags");
		expect(values).toEqual(["ok"]);
		expect(values).not.toContain("[object Object]");
	});

	it("skips a file whose contents cannot be read for inline fields", async () => {
		const app = fileCacheApp(
			{ "a.md": {}, "b.md": {} },
			async (file: FakeFile) => {
				if (file.path === "a.md") throw new Error("EACCES");
				return "priority:: high\n";
			},
		);
		const { api } = getApi(app);

		const values = await api.fieldSuggestions.getFieldValues("priority", {
			includeInline: true,
		});
		// The unreadable a.md is skipped; b.md still contributes.
		expect(values).toEqual(["high"]);
	});
});
