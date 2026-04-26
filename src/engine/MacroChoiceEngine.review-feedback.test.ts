import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockGetUserScript, mockOpenFile } = vi.hoisted(() => ({
	mockGetUserScript: vi.fn(),
	mockOpenFile: vi.fn(),
}));

vi.mock("../quickAddSettingsTab", () => {
	const defaultSettings = {
		choices: [],
		inputPrompt: "single-line",
		devMode: false,
		templateFolderPath: "",
		useSelectionAsCaptureValue: true,
		announceUpdates: "major",
		version: "0.0.0",
		globalVariables: {},
		onePageInputEnabled: false,
		disableOnlineFeatures: true,
		enableRibbonIcon: false,
		showCaptureNotification: true,
		showInputCancellationNotification: true,
		enableTemplatePropertyTypes: false,
		ai: {
			defaultModel: "Ask me",
			defaultSystemPrompt: "",
			promptTemplatesFolderPath: "",
			showAssistant: true,
			providers: [],
		},
		migrations: {
			migrateToMacroIDFromEmbeddedMacro: true,
			useQuickAddTemplateFolder: false,
			incrementFileNameSettingMoveToDefaultBehavior: false,
			consolidateFileExistsBehavior: false,
			mutualExclusionInsertAfterAndWriteToBottomOfFile: false,
			setVersionAfterUpdateModalRelease: false,
			addDefaultAIProviders: false,
			removeMacroIndirection: false,
			migrateFileOpeningSettings: false,
			backfillFileOpeningDefaults: false,
		},
	};

	return {
		DEFAULT_SETTINGS: defaultSettings,
		QuickAddSettingsTab: class {},
	};
});

vi.mock("../formatters/completeFormatter", () => ({
	CompleteFormatter: class CompleteFormatterMock {
		async formatFileName(input: string) {
			return input;
		}
	},
}));

vi.mock("obsidian-dataview", () => ({
	getAPI: vi.fn(),
}));

vi.mock("../main", () => ({
	default: class QuickAddMock {},
}));

vi.mock("../utilityObsidian", () => ({
	getUserScript: mockGetUserScript,
	openFile: mockOpenFile,
}));

import type { App } from "obsidian";
import { TFile } from "obsidian";
import type { IChoiceExecutor } from "../IChoiceExecutor";
import { MacroAbortError } from "../errors/MacroAbortError";
import type IChoice from "../types/choices/IChoice";
import type IMacroChoice from "../types/choices/IMacroChoice";
import { CommandType } from "../types/macros/CommandType";
import type { IMacro } from "../types/macros/IMacro";
import type { IUserScript } from "../types/macros/IUserScript";
import { IntegrationRegistry } from "../integrations/IntegrationRegistry";
import { MacroChoiceEngine } from "./MacroChoiceEngine";
import {
	createChoiceExecutionContext,
	createChoiceExecutionResult,
} from "./runtime";

function createChoiceExecutor(): IChoiceExecutor {
	return {
		variables: new Map<string, unknown>(),
		execute: vi.fn(async (choice) =>
			createChoiceExecutionResult({
				status: "success",
				choiceId: choice.id,
			}),
		),
	};
}

describe("MacroChoiceEngine review feedback regressions", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("does not keep partial branch results when a conditional branch aborts", async () => {
		const app = {} as App;
		const plugin = {} as any;
		const nestedChoice: IChoice = {
			id: "nested-choice",
			name: "Nested choice",
			type: "Template",
			command: false,
		};
		const macro: IMacro = {
			id: "macro-id",
			name: "Conditional macro",
			commands: [
				{
					id: "conditional-command",
					name: "Conditional",
					type: CommandType.Conditional,
					condition: {
						mode: "variable",
						variableName: "runThen",
						operator: "equals",
						valueType: "boolean",
						expectedValue: "true",
					},
					thenCommands: [
						{
							id: "branch-obsidian",
							name: "Branch Obsidian",
							type: CommandType.Obsidian,
							commandId: "branch-obsidian",
						} as any,
						{
							id: "branch-nested",
							name: "Branch nested choice",
							type: CommandType.NestedChoice,
							choice: nestedChoice,
						} as any,
					],
					elseCommands: [],
				} as any,
			],
		};
		const choice: IMacroChoice = {
			id: "choice-id",
			name: "Conditional Macro",
			type: "Macro",
			command: false,
			macro,
			runOnStartup: false,
		};

		let pendingAbort: MacroAbortError | null = null;
		const choiceExecutor: IChoiceExecutor = {
			variables: new Map<string, unknown>([["runThen", true]]),
			execute: vi.fn(async (choiceToRun) => {
				if (choiceToRun.id === nestedChoice.id) {
					const abort = new MacroAbortError("Input cancelled by user");
					pendingAbort = abort;
					return createChoiceExecutionResult({
						status: "aborted",
						choiceId: choiceToRun.id,
						error: abort,
					});
				}

				return createChoiceExecutionResult({
					status: "success",
					choiceId: choiceToRun.id,
				});
			}),
			signalAbort: vi.fn((error: MacroAbortError) => {
				pendingAbort = error;
			}),
			consumeAbortSignal: vi.fn(() => {
				const abort = pendingAbort;
				pendingAbort = null;
				return abort;
			}),
		};

		class ObservationMacroChoiceEngine extends MacroChoiceEngine {
			public obsidianExecutions = 0;

			protected override executeObsidianCommand(): void {
				this.obsidianExecutions += 1;
			}
		}

		const engine = new ObservationMacroChoiceEngine(
			app,
			plugin,
			choice,
			choiceExecutor,
			choiceExecutor.variables,
		);

		const result = await engine.run();

		expect(result.status).toBe("aborted");
		expect(engine.obsidianExecutions).toBe(1);
		expect(engine.getCommandResults()).toHaveLength(1);
		expect(engine.getCommandResults()[0]).toMatchObject({
			commandId: "conditional-command",
			status: "aborted",
		});
	});

	it("preserves the abort error on the macro-level result", async () => {
		const app = {} as App;
		const plugin = {} as any;
		const macro: IMacro = {
			id: "macro-id",
			name: "Abort macro",
			commands: [
				{
					id: "obsidian-command",
					name: "Obsidian",
					type: CommandType.Obsidian,
					commandId: "do-something",
				} as any,
			],
		};
		const choice: IMacroChoice = {
			id: "choice-id",
			name: "Abort Macro",
			type: "Macro",
			command: false,
			macro,
			runOnStartup: false,
		};

		class AbortMacroChoiceEngine extends MacroChoiceEngine {
			protected override executeObsidianCommand(): void {
				throw new MacroAbortError("Input cancelled by user");
			}
		}

		const engine = new AbortMacroChoiceEngine(
			app,
			plugin,
			choice,
			createChoiceExecutor(),
			new Map<string, unknown>(),
		);

		const result = await engine.run();

		expect(result.status).toBe("aborted");
		expect(result.error).toBeInstanceOf(MacroAbortError);
		expect((result.error as MacroAbortError).message).toBe(
			"Input cancelled by user",
		);
	});

	it("uses the execution context origin leaf for open-file commands", async () => {
		const originLeaf = { id: "origin-leaf" } as any;
		const file = Object.assign(Object.create(TFile.prototype), {
			path: "note.md",
		}) as TFile;
		const app = {
			vault: {
				getAbstractFileByPath: vi.fn().mockReturnValue(file),
			},
		} as unknown as App;
		const plugin = {} as any;
		const macro: IMacro = {
			id: "macro-id",
			name: "Open file macro",
			commands: [
				{
					id: "open-file-command",
					name: "Open file",
					type: CommandType.OpenFile,
					filePath: "note.md",
				} as any,
			],
		};
		const choice: IMacroChoice = {
			id: "choice-id",
			name: "Open File Macro",
			type: "Macro",
			command: false,
			macro,
			runOnStartup: false,
		};
		const context = createChoiceExecutionContext({
			originLeaf,
			variables: new Map<string, unknown>(),
			integrations: new IntegrationRegistry(),
		});
		const choiceExecutor: IChoiceExecutor = {
			variables: context.variables,
			execute: vi.fn(),
			getExecutionContext: () => context,
		};

		const engine = new MacroChoiceEngine(
			app,
			plugin,
			choice,
			choiceExecutor,
			context.variables,
			undefined,
			undefined,
			null,
		);

		await engine.run();

		expect(mockOpenFile).toHaveBeenCalledWith(
			app,
			file,
			expect.objectContaining({ originLeaf }),
		);
	});

	it("preserves successful command results when a later command fails", async () => {
		const app = {} as App;
		const plugin = {} as any;
		const macro: IMacro = {
			id: "macro-id",
			name: "Failure macro",
			commands: [
				{
					id: "first-command",
					name: "First",
					type: CommandType.Obsidian,
					commandId: "first",
				} as any,
				{
					id: "second-command",
					name: "Second",
					type: CommandType.Obsidian,
					commandId: "second",
				} as any,
			],
		};
		const choice: IMacroChoice = {
			id: "choice-id",
			name: "Failure Macro",
			type: "Macro",
			command: false,
			macro,
			runOnStartup: false,
		};

		class FailureMacroChoiceEngine extends MacroChoiceEngine {
			private executionCount = 0;

			protected override executeObsidianCommand(): void {
				this.executionCount += 1;
				if (this.executionCount === 2) {
					throw new Error("Boom");
				}
			}
		}

		const engine = new FailureMacroChoiceEngine(
			app,
			plugin,
			choice,
			createChoiceExecutor(),
			new Map<string, unknown>(),
		);

		await expect(engine.run()).rejects.toThrow("Boom");
		expect(engine.getCommandResults()).toHaveLength(2);
		expect(engine.getCommandResults()[0]).toMatchObject({
			commandId: "first-command",
			status: "success",
		});
		expect(engine.getCommandResults()[1]).toMatchObject({
			commandId: "second-command",
			status: "failed",
		});
	});

	it("only records command values for commands that produce output", async () => {
		const app = {} as App;
		const plugin = {} as any;
		const macro: IMacro = {
			id: "macro-id",
			name: "Output macro",
			commands: [
				{
					id: "script-command",
					name: "Script",
					type: CommandType.UserScript,
					path: "script.js",
					settings: {},
				} as IUserScript,
				{
					id: "obsidian-command",
					name: "Obsidian",
					type: CommandType.Obsidian,
					commandId: "do-something",
				} as any,
			],
		};
		const choice: IMacroChoice = {
			id: "choice-id",
			name: "Output Macro",
			type: "Macro",
			command: false,
			macro,
			runOnStartup: false,
		};

		class OutputMacroChoiceEngine extends MacroChoiceEngine {
			protected override async executeUserScript(): Promise<void> {
				this.setOutput("script output");
			}

			protected override executeObsidianCommand(): void {}
		}

		const engine = new OutputMacroChoiceEngine(
			app,
			plugin,
			choice,
			createChoiceExecutor(),
			new Map<string, unknown>(),
		);

		const result = await engine.run();
		const [scriptResult, obsidianResult] = engine.getCommandResults();

		expect(result.status).toBe("success");
		expect(scriptResult?.value).toBe("script output");
		expect(obsidianResult?.value).toBeUndefined();
		expect(result.value).toMatchObject({
			output: "script output",
		});
	});
});
