import { beforeEach, describe, expect, it, vi } from "vitest";
import type { App, TFile } from "obsidian";
import type QuickAdd from "../main";
import type { IChoiceExecutor } from "../IChoiceExecutor";
import type ITemplateChoice from "../types/choices/ITemplateChoice";
import { VALUE_SYNTAX } from "../constants";

vi.mock("../gui/GenericSuggester/genericSuggester", () => ({
	default: { Suggest: vi.fn() },
}));

import GenericSuggester from "../gui/GenericSuggester/genericSuggester";
import {
	collectChoiceRequirements,
	getUnresolvedRequirements,
} from "../preflight/collectChoiceRequirements";
import {
	createFolderTemplateChoice,
	hasConfiguredTemplateFolders,
	runTemplateFromFolder,
} from "./runTemplateFromFolder";

const suggestMock = vi.mocked(GenericSuggester.Suggest);

function tfile(path: string): TFile {
	const segments = path.split("/");
	const name = segments[segments.length - 1];
	return {
		path,
		name,
		basename: name.replace(/\.[^.]+$/, ""),
		extension: name.includes(".") ? name.split(".").pop()! : "",
	} as TFile;
}

function createExecutor(): IChoiceExecutor {
	return {
		execute: vi.fn().mockResolvedValue(undefined),
		variables: new Map<string, unknown>(),
		consumeAbortSignal: vi.fn().mockReturnValue(null),
	} as unknown as IChoiceExecutor;
}

function createPlugin(overrides: {
	templateFolderPaths?: string[];
	templateFiles?: TFile[];
}): QuickAdd {
	return {
		settings: {
			templateFolderPaths: overrides.templateFolderPaths ?? [],
		},
		getTemplateFiles: vi.fn(() => overrides.templateFiles ?? []),
		manifest: { id: "quickadd" },
	} as unknown as QuickAdd;
}

const app = {} as App;

describe("createFolderTemplateChoice", () => {
	it("builds an openable Template choice named after the file basename", () => {
		const choice = createFolderTemplateChoice("Templates/Daily Note.md");

		expect(choice.type).toBe("Template");
		expect(choice.name).toBe("Daily Note");
		expect(choice.templatePath).toBe("Templates/Daily Note.md");
		expect(choice.openFile).toBe(true);
	});

	it("enables fileNameFormat with VALUE_SYNTAX so the name prompt is visible to preflight", () => {
		// Load-bearing: collectChoiceRequirements only scans the format when enabled.
		const choice = createFolderTemplateChoice("Templates/Daily.md");
		expect(choice.fileNameFormat.enabled).toBe(true);
		expect(choice.fileNameFormat.format).toBe(VALUE_SYNTAX);
		// Default location for new notes — no folder prompt.
		expect(choice.folder.enabled).toBe(false);
	});

	it("handles extensionless and nested paths for the display name", () => {
		expect(createFolderTemplateChoice("note").name).toBe("note");
		expect(createFolderTemplateChoice("a/b/c/My Template.md").name).toBe(
			"My Template",
		);
		expect(createFolderTemplateChoice("Canvas Tpl.canvas").name).toBe(
			"Canvas Tpl",
		);
		expect(createFolderTemplateChoice("Templates/t_general.eta").name).toBe(
			"t_general",
		);
	});

	it("returns a fresh uuid id each call (never persisted, no deterministic collision)", () => {
		const a = createFolderTemplateChoice("Templates/X.md");
		const b = createFolderTemplateChoice("Templates/X.md");
		expect(a.id).not.toBe(b.id);
	});
});

describe("hasConfiguredTemplateFolders", () => {
	it("is false for an empty/blank folder list", () => {
		expect(hasConfiguredTemplateFolders(createPlugin({}))).toBe(false);
		expect(
			hasConfiguredTemplateFolders(
				createPlugin({ templateFolderPaths: ["  ", "/"] }),
			),
		).toBe(false);
	});

	it("is true when at least one folder is configured", () => {
		expect(
			hasConfiguredTemplateFolders(
				createPlugin({ templateFolderPaths: ["Templates"] }),
			),
		).toBe(true);
	});
});

describe("runTemplateFromFolder", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("runs a given template path directly without a picker or config gate", async () => {
		const executor = createExecutor();
		// No template folders configured, but an explicit path must still run.
		await runTemplateFromFolder(app, createPlugin({}), {
			templatePath: "Templates/Daily.md",
			choiceExecutor: executor,
		});

		expect(executor.execute).toHaveBeenCalledTimes(1);
		const choice = (executor.execute as ReturnType<typeof vi.fn>).mock
			.calls[0][0] as ITemplateChoice;
		expect(choice.templatePath).toBe("Templates/Daily.md");
		expect(choice.fileNameFormat.enabled).toBe(true);
	});

	it("does not execute when interactive and no template folder is configured", async () => {
		const executor = createExecutor();
		await runTemplateFromFolder(app, createPlugin({}), {
			choiceExecutor: executor,
		});
		expect(executor.execute).not.toHaveBeenCalled();
	});

	it("does not execute when the configured folder has no template files", async () => {
		const executor = createExecutor();
		await runTemplateFromFolder(
			app,
			createPlugin({ templateFolderPaths: ["Templates"], templateFiles: [] }),
			{ choiceExecutor: executor },
		);
		expect(executor.execute).not.toHaveBeenCalled();
	});

	it("runs the picked template when the user selects one", async () => {
		const executor = createExecutor();
		suggestMock.mockResolvedValueOnce("Templates/Daily.md");
		await runTemplateFromFolder(
			app,
			createPlugin({
				templateFolderPaths: ["Templates"],
				templateFiles: [tfile("Templates/Daily.md")],
			}),
			{ choiceExecutor: executor },
		);
		expect(executor.execute).toHaveBeenCalledTimes(1);
		const choice = (executor.execute as ReturnType<typeof vi.fn>).mock
			.calls[0][0] as ITemplateChoice;
		expect(choice.templatePath).toBe("Templates/Daily.md");
	});

	it("does not execute when the picker is cancelled", async () => {
		const executor = createExecutor();
		// GenericSuggester rejects with this exact reason on dismissal.
		suggestMock.mockRejectedValueOnce("no input given.");
		await runTemplateFromFolder(
			app,
			createPlugin({
				templateFolderPaths: ["Templates"],
				templateFiles: [tfile("Templates/Daily.md")],
			}),
			{ choiceExecutor: executor },
		);
		expect(executor.execute).not.toHaveBeenCalled();
	});
});

describe("createFolderTemplateChoice + real preflight collector", () => {
	const collectorApp = {
		workspace: { getActiveFile: () => null },
		vault: { getAbstractFileByPath: () => null, cachedRead: async () => "" },
	} as unknown as App;
	const collectorPlugin = {
		settings: { inputPrompt: "single-line", globalVariables: {} },
	} as unknown as QuickAdd;

	it("surfaces the note-name as a required input (load-bearing fileNameFormat.enabled)", async () => {
		const executor = createExecutor();
		const choice = createFolderTemplateChoice("Templates/Daily.md");
		const reqs = await collectChoiceRequirements(
			collectorApp,
			collectorPlugin,
			executor,
			choice,
		);
		const unresolved = getUnresolvedRequirements(reqs, executor.variables);
		expect(reqs.some((r) => r.id === "value")).toBe(true);
		expect(unresolved.some((r) => r.id === "value")).toBe(true);
	});

	it("negative control: disabling fileNameFormat hides the note-name requirement", async () => {
		const executor = createExecutor();
		const choice = createFolderTemplateChoice("Templates/Daily.md");
		choice.fileNameFormat = { enabled: false, format: VALUE_SYNTAX };
		const reqs = await collectChoiceRequirements(
			collectorApp,
			collectorPlugin,
			executor,
			choice,
		);
		expect(reqs.some((r) => r.id === "value")).toBe(false);
	});
});
