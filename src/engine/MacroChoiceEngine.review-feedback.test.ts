import { describe, expect, it, vi } from "vitest";

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
	CompleteFormatter: class CompleteFormatterMock {},
}));

vi.mock("obsidian-dataview", () => ({
	getAPI: vi.fn(),
}));

vi.mock("../main", () => ({
	default: class QuickAddMock {},
}));

import type { App } from "obsidian";
import type { IChoiceExecutor } from "../IChoiceExecutor";
import { MacroAbortError } from "../errors/MacroAbortError";
import type IChoice from "../types/choices/IChoice";
import type IMacroChoice from "../types/choices/IMacroChoice";
import { CommandType } from "../types/macros/CommandType";
import type { IMacro } from "../types/macros/IMacro";
import type { IUserScript } from "../types/macros/IUserScript";
import { MacroChoiceEngine } from "./MacroChoiceEngine";
import { createChoiceExecutionResult } from "./runtime";

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
