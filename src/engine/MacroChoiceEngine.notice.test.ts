import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../quickAddSettingsTab", () => {
	const defaultSettings = {
		choices: [],
		inputPrompt: "single-line",
		devMode: false,
		templateFolderPath: "",
		announceUpdates: true,
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
			mutualExclusionInsertAfterAndWriteToBottomOfFile: false,
			setVersionAfterUpdateModalRelease: false,
			addDefaultAIProviders: false,
			removeMacroIndirection: false,
			migrateFileOpeningSettings: false,
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
import { Notice } from "obsidian";
import type IMacroChoice from "../types/choices/IMacroChoice";
import type { IChoiceExecutor } from "../IChoiceExecutor";
import type { IMacro } from "../types/macros/IMacro";
import { CommandType } from "../types/macros/CommandType";
import { MacroChoiceEngine } from "./MacroChoiceEngine";
import { MacroAbortError } from "../errors/MacroAbortError";
import { settingsStore } from "../settingsStore";
import type IChoice from "../types/choices/IChoice";

const defaultSettingsState = structuredClone(settingsStore.getState());

type NoticeTestClass = typeof Notice & {
	instances: Array<{ message: string; timeout?: number }>;
};

const noticeClass = Notice as unknown as NoticeTestClass;

class CancellationTestMacroChoiceEngine extends MacroChoiceEngine {
	private abortMessage: string;

	constructor(
		app: App,
		plugin: any,
		choice: IMacroChoice,
		choiceExecutor: IChoiceExecutor,
		variables: Map<string, unknown>,
		abortMessage: string
	) {
		super(app, plugin, choice, choiceExecutor, variables);
		this.abortMessage = abortMessage;
	}

	protected override executeObsidianCommand(): void {
		throw new MacroAbortError(this.abortMessage);
	}
}

const createTestEngine = (abortMessage: string) => {
	const app = {} as App;
	const plugin = { settings: settingsStore.getState() } as any;
	const macro: IMacro = {
		id: "macro-id",
		name: "Test macro",
		commands: [
			{
				type: CommandType.Obsidian,
			} as any,
		],
	};
	const choice: IMacroChoice = {
		id: "choice-id",
		name: "Test choice",
		type: "Macro",
		command: false,
		macro,
		runOnStartup: false,
	};
	const choiceExecutor: IChoiceExecutor = {
		execute: vi.fn(),
		variables: new Map<string, unknown>(),
	};
	const variables = new Map<string, unknown>();

	return new CancellationTestMacroChoiceEngine(
		app,
		plugin,
		choice,
		choiceExecutor,
		variables,
		abortMessage
	);
};

describe("MacroChoiceEngine cancellation notices", () => {
	beforeEach(() => {
		settingsStore.setState(structuredClone(defaultSettingsState));
		noticeClass.instances.length = 0;
	});

	it("shows a cancellation notice when the setting is enabled", async () => {
		settingsStore.setState({
			...settingsStore.getState(),
			showInputCancellationNotification: true,
		});
		const engine = createTestEngine("Input cancelled by user");

		await engine.run();

		expect(noticeClass.instances).toHaveLength(1);
		expect(noticeClass.instances[0]?.message).toContain("Input cancelled by user");
	});

	it("suppresses cancellation notices when the setting is disabled", async () => {
		settingsStore.setState({
			...settingsStore.getState(),
			showInputCancellationNotification: false,
		});
		const engine = createTestEngine("Input cancelled by user");

		await engine.run();

		expect(noticeClass.instances).toHaveLength(0);
	});

	it("still shows notices for other abort reasons", async () => {
		settingsStore.setState({
			...settingsStore.getState(),
			showInputCancellationNotification: false,
		});
		const engine = createTestEngine("Invalid project name");

		await engine.run();

		expect(noticeClass.instances).toHaveLength(1);
		expect(noticeClass.instances[0]?.message).toContain("Invalid project name");
});

describe("MacroChoiceEngine nested choice propagation", () => {
	it("halts subsequent commands when a nested choice cancels", async () => {
		const app = {} as App;
		const plugin = { settings: settingsStore.getState() } as any;
		const nestedChoice: IChoice = {
			id: "nested-template",
			name: "Nested Template",
			type: "Template",
			command: false,
		};
		const macro: IMacro = {
			id: "macro-id",
			name: "Macro with nested choice",
			commands: [
				{
					id: "nested-command",
					name: "Nested choice",
					type: CommandType.NestedChoice,
					choice: nestedChoice,
				},
				{
					id: "obsidian",
					name: "Should not run",
					type: CommandType.Obsidian,
				} as any,
			],
		};
		const choice: IMacroChoice = {
			id: "choice-id",
			name: "Macro",
			type: "Macro",
			command: false,
			macro,
			runOnStartup: false,
		};

		let pendingAbort: MacroAbortError | null = null;
		const signalAbort = vi.fn((error: MacroAbortError) => {
			pendingAbort = error;
		});
		const consumeAbortSignal = vi.fn(() => {
			const error = pendingAbort;
			pendingAbort = null;
			return error;
		});
		const choiceExecutor: IChoiceExecutor = {
			variables: new Map<string, unknown>(),
			execute: vi.fn(async (choiceToRun) => {
				if (choiceToRun.id === nestedChoice.id) {
					signalAbort(new MacroAbortError("Input cancelled by user"));
				}
			}),
			signalAbort,
			consumeAbortSignal,
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
			new Map<string, unknown>(),
		);

		await engine.run();

		expect(choiceExecutor.execute).toHaveBeenCalledTimes(1);
		expect(signalAbort).toHaveBeenCalled();
		expect(signalAbort.mock.calls.at(-1)?.[0]).toBeInstanceOf(MacroAbortError);
		expect(consumeAbortSignal).toHaveBeenCalledTimes(1);
		expect(engine.obsidianExecutions).toBe(0);
	});
});
});
