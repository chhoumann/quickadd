import { createChoiceExecutor } from "../../tests/helpers/createChoiceExecutor";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../quickAddSettingsTab", async () => {
	const { engineSettingsMock } = await import("../../tests/helpers/engines/settings");
	return engineSettingsMock();
});

vi.mock("../formatters/completeFormatter", () => ({
	CompleteFormatter: class CompleteFormatterMock {},
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
import { ConditionalCommand } from "../types/macros/Conditional/ConditionalCommand";
import { MacroChoiceEngine } from "./MacroChoiceEngine";
import { MacroAbortError } from "../errors/MacroAbortError";
import { UserCancelError } from "../errors/UserCancelError";
import { handleMacroAbort } from "../utils/macroAbortHandler";
import { refuse } from "../errors/RefusalError";
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
		// A user prompt-dismissal surfaces as UserCancelError in production; other
		// aborts stay plain MacroAbortError.
		throw this.abortMessage.toLowerCase().includes("cancelled by user")
			? new UserCancelError(this.abortMessage)
			: new MacroAbortError(this.abortMessage);
	}
}

const createTestEngine = (
	abortMessage: string,
	commands: IMacro["commands"] = [{ type: CommandType.Obsidian } as any],
	runChoice?: (executor: IChoiceExecutor) => Promise<void>,
) => {
	const app = {} as App;
	const plugin = { settings: settingsStore.getState() } as any;
	const macro: IMacro = {
		id: "macro-id",
		name: "Test macro",
		commands,
	};
	const choice: IMacroChoice = {
		id: "choice-id",
		name: "Test choice",
		type: "Macro",
		command: false,
		macro,
		runOnStartup: false,
	};
	let pendingAbort: MacroAbortError | null = null;
	const choiceExecutor: IChoiceExecutor = {
		...createChoiceExecutor(),
		execute: vi.fn(() => runChoice?.(choiceExecutor) ?? Promise.resolve()),
		variables: new Map<string, unknown>(),
		signalAbort: (error) => {
			pendingAbort = error;
		},
		consumeAbortSignal: () => {
			const error = pendingAbort;
			pendingAbort = null;
			return error;
		},
	};
	const variables = new Map<string, unknown>([["go", "yes"]]);

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

	it("says a bare abort() once", async () => {
		const engine = createTestEngine("");

		await engine.run();

		expect(noticeClass.instances.map((notice) => notice.message)).toEqual([
			"Macro execution aborted",
		]);
	});

	it("shows one notice when a conditional branch aborts the macro", async () => {
		const engine = createTestEngine("Stopped on purpose", [
			new ConditionalCommand({
				condition: { mode: "variable", variableName: "go", operator: "isTruthy", valueType: "string" },
				thenCommands: [{ type: CommandType.Obsidian } as any],
				elseCommands: [],
			}),
		]);

		await engine.run();

		expect(noticeClass.instances.map((notice) => notice.message)).toEqual([
			"Macro execution aborted: Stopped on purpose",
		]);
	});

	it("leaves the notice to a Capture step that aborts inside the macro", async () => {
		const capture: IChoice = { id: "capture", name: "Capture", type: "Capture", command: false };
		// What CaptureChoiceEngine does when its run aborts.
		const engine = createTestEngine(
			"unused",
			[{ id: "step", name: "Capture", type: CommandType.NestedChoice, choice: capture } as any],
			async (executor) => {
				const error = new MacroAbortError("Target file missing: Inbox.md");
				handleMacroAbort(error, {
					choiceName: "Capture",
					logPrefix: "Capture execution aborted",
					defaultReason: "Capture aborted",
				});
				executor.signalAbort?.(error);
			},
		);

		await engine.run();

		expect(noticeClass.instances.map((notice) => notice.message)).toEqual([
			"Capture execution aborted: Target file missing: Inbox.md",
		]);
	});

	it("stops at a step's refusal and names the step's choice, not the sequence", async () => {
		const log: IChoice = { id: "log", name: "Log", type: "Capture", command: false };
		const after = vi.fn();
		const engine = createTestEngine(
			"unused",
			[
				{ id: "step", name: "Log", type: CommandType.NestedChoice, choice: log } as any,
				{ id: "after", name: "After", type: CommandType.NestedChoice, choice: { ...log, id: "after" } } as any,
			],
			async (executor) => {
				after();
				if (after.mock.calls.length > 1) return;
				// What CaptureChoiceEngine does when a guard refuses.
				const error = refuse("The Daily notes core plugin is off", "{{DAILY}} has no note to point at", "Turn it on in Settings > Core plugins.");
				handleMacroAbort(error, { choiceName: "Log", logPrefix: "Capture execution aborted", defaultReason: "Capture aborted" });
				executor.signalAbort?.(error);
			},
		);

		await engine.run();

		expect(after).toHaveBeenCalledTimes(1);
		expect(noticeClass.instances.map((notice) => notice.message)).toEqual([
			"Log: the Daily notes core plugin is off, so {{DAILY}} has no note to point at. Turn it on in Settings > Core plugins.",
		]);
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
			...createChoiceExecutor(),
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
