import { createChoiceExecutor } from "../../tests/helpers/createChoiceExecutor";
import { describe, expect, it, vi, beforeEach, afterEach, afterAll } from "vitest";

vi.mock("../quickAddApi", () => ({
	QuickAddApi: {
		GetApi: vi.fn(),
	},
}));
vi.mock("../gui/GenericSuggester/genericSuggester", () => ({
	default: class GenericSuggesterMock {
		static Suggest() {
			return Promise.resolve(undefined);
		}
	},
}));
vi.mock("../main", () => ({
	default: class QuickAddMock {},
}));
vi.mock("../gui/choiceList/ChoiceView.svelte", () => ({}));
vi.mock("../quickAddSettingsTab", () => ({
	DEFAULT_SETTINGS: {},
	QuickAddSettingsTab: class {},
}));
vi.mock("../settingsStore", () => ({
	settingsStore: {
		getState: () => ({
			ai: {},
			disableOnlineFeatures: false,
			showInputCancellationNotification: false,
		}),
	},
}));
vi.mock("../formatters/completeFormatter", () => ({
	CompleteFormatter: class CompleteFormatterMock {
		constructor() {}
	},
}));
vi.mock("../ai/AIAssistant", () => ({
	runAIAssistant: vi.fn(),
}));
vi.mock("../ai/aiHelpers", () => ({
	getModelByName: vi.fn(),
	getModelNames: vi.fn().mockReturnValue([]),
	getModelProvider: vi.fn().mockReturnValue({ apiKey: "" }),
}));

import type { App } from "obsidian";
import { MacroChoiceEngine, OBSIDIAN_COMMAND_WAIT_MS } from "./MacroChoiceEngine";
import { log } from "../logger/logManager";
import { ConditionalCommand } from "../types/macros/Conditional/ConditionalCommand";
import { ObsidianCommand } from "../types/macros/ObsidianCommand";
import { ChoiceCommand } from "../types/macros/ChoiceCommand";
import type { ICommand } from "../types/macros/ICommand";
import type { IMacro } from "../types/macros/IMacro";
import type IMacroChoice from "../types/choices/IMacroChoice";
import type { IChoiceExecutor } from "../IChoiceExecutor";
import { MacroAbortError } from "../errors/MacroAbortError";
import { QuickAddApi } from "../quickAddApi";

const getApiMock = QuickAddApi.GetApi as unknown as ReturnType<typeof vi.fn>;

/**
 * Minimal choice executor stub that mirrors the real ChoiceExecutor's
 * pendingAbort handshake so the engine's abort propagation can be exercised.
 */
function createChoiceExecutorStub(
	executeImpl: (executor: IChoiceExecutor) => void | Promise<void> = () => {}
): IChoiceExecutor {
	let pendingAbort: MacroAbortError | null = null;
	const executor: IChoiceExecutor = {
		...createChoiceExecutor(),
		variables: new Map<string, unknown>(),
		execute: vi.fn(async () => {
			await executeImpl(executor);
		}),
		signalAbort: (error: MacroAbortError) => {
			pendingAbort = error;
		},
		consumeAbortSignal: () => {
			const abort = pendingAbort;
			pendingAbort = null;
			return abort;
		},
	};
	return executor;
}

interface RegistryEntry {
	id: string;
	name: string;
	callback?: () => unknown;
	checkCallback?: (checking: boolean) => unknown;
}

interface CreateEngineOptions {
	commands: ICommand[];
	registeredCommandIds?: string[];
	registeredCommands?: Record<string, RegistryEntry>;
	getChoiceById?: (id: string) => unknown;
	choiceExecutor?: IChoiceExecutor;
	variables?: Record<string, unknown>;
}

function createEngine({
	commands,
	registeredCommandIds = [],
	registeredCommands = {},
	getChoiceById = vi.fn(),
	choiceExecutor = createChoiceExecutorStub(),
	variables = {},
}: CreateEngineOptions) {
	const commandRegistry: Record<string, RegistryEntry> = { ...registeredCommands };
	for (const id of registeredCommandIds) {
		commandRegistry[id] = { id, name: id };
	}
	// What Obsidian 1.13.7's executeCommandById does: run checkCallback(false)
	// when there is one, else callback(), and return true either way.
	const executeCommandById = vi.fn((id: string) => {
		const entry = commandRegistry[id];
		if (!entry) return false;
		if (entry.checkCallback) entry.checkCallback(false);
		else entry.callback?.();
		return true;
	});

	const app = {
		commands: {
			commands: commandRegistry,
			executeCommandById,
		},
	} as unknown as App;

	const plugin = {
		getChoiceById,
		getChoiceByName: vi.fn(),
	} as unknown as any;

	const macro: IMacro = {
		name: "Test macro",
		id: "macro-id",
		commands,
	};

	const choice: IMacroChoice = {
		name: "Test choice",
		id: "choice-id",
		type: "Macro",
		command: false,
		macro,
		runOnStartup: false,
	};

	const engine = new MacroChoiceEngine(
		app,
		plugin,
		choice,
		choiceExecutor,
		new Map<string, unknown>(Object.entries(variables))
	);

	return { engine, executeCommandById, choiceExecutor };
}

describe("MacroChoiceEngine audit fixes", () => {
	beforeEach(() => {
		getApiMock.mockReturnValue({});
		vi.clearAllMocks();
	});

	afterEach(() => {
		getApiMock.mockClear();
	});

	afterAll(() => {
		getApiMock.mockReset();
	});

	describe("executeChoice with a deleted referenced choice", () => {
		it("skips the choice and continues the macro instead of throwing", async () => {
			const runMarker = new ObsidianCommand("After", "after-id");
			runMarker.generateId();
			const choiceCommand = new ChoiceCommand("Missing choice", "gone-id");

			const { engine, executeCommandById } = createEngine({
				commands: [choiceCommand, runMarker],
				registeredCommandIds: ["after-id"],
				getChoiceById: vi.fn(() => {
					// Mirror plugin.getChoiceById, which THROWS when the choice was deleted.
					throw new Error("Choice gone-id not found");
				}),
			});

			// Must not reject: the deleted choice is skipped, not a hard crash.
			await expect(engine.run()).resolves.toBeUndefined();
			// The macro keeps running the commands after the missing choice.
			expect(executeCommandById).toHaveBeenCalledWith("after-id");
		});
	});

	describe("executeConditional abort propagation", () => {
		it("halts the macro when a command inside the branch aborts", async () => {
			const abortingChoice = new ChoiceCommand("Aborts", "abort-choice");
			const afterBranch = new ObsidianCommand("After branch", "after-branch");
			afterBranch.generateId();

			const conditional = new ConditionalCommand({
				condition: {
					mode: "variable",
					variableName: "flag",
					operator: "isTruthy",
					valueType: "boolean",
				},
				thenCommands: [abortingChoice, afterBranch],
				elseCommands: [],
			});

			const afterConditional = new ObsidianCommand(
				"After conditional",
				"after-conditional"
			);
			afterConditional.generateId();

			const choiceExecutor = createChoiceExecutorStub((executor) => {
				// The aborting branch command signals an abort, like a cancelled prompt.
				executor.signalAbort?.(new MacroAbortError("aborted in branch"));
			});

			const { engine, executeCommandById } = createEngine({
				commands: [conditional, afterConditional],
				registeredCommandIds: [
					"after-branch",
					"after-conditional",
				],
				getChoiceById: vi.fn(() => ({
					id: "abort-choice",
					name: "Aborts",
				})),
				choiceExecutor,
				variables: { flag: true },
			});

			await engine.run();

			// Neither the later branch command nor the command after the conditional
			// should run once the branch aborted.
			expect(executeCommandById).not.toHaveBeenCalledWith("after-branch");
			expect(executeCommandById).not.toHaveBeenCalledWith(
				"after-conditional"
			);
		});
	});

	describe("executeObsidianCommand for an uninstalled command", () => {
		it("does not invoke executeCommandById when the command id is unregistered", async () => {
			const missing = new ObsidianCommand("Gone plugin command", "gone:cmd");
			missing.generateId();

			const { engine, executeCommandById } = createEngine({
				commands: [missing],
				registeredCommandIds: [],
			});

			await engine.run();

			expect(executeCommandById).not.toHaveBeenCalled();
		});

		it("invokes executeCommandById when the command id is still registered", async () => {
			const present = new ObsidianCommand("Real command", "real:cmd");
			present.generateId();

			const { engine, executeCommandById } = createEngine({
				commands: [present],
				registeredCommandIds: ["real:cmd"],
			});

			await engine.run();

			expect(executeCommandById).toHaveBeenCalledWith("real:cmd");
		});
	});

	describe("executeObsidianCommand waiting for the command", () => {
		const step = (name: string, commandId: string) => {
			const command = new ObsidianCommand(name, commandId);
			command.generateId();
			return command;
		};

		afterEach(() => {
			vi.useRealTimers();
			vi.restoreAllMocks();
		});

		it("runs the next step only after the promise a command's callback returns settles", async () => {
			let finish!: () => void;
			const order: string[] = [];
			const opensNote = {
				id: "opens:note",
				name: "Open note",
				callback: () => new Promise<void>((resolve) => {
					finish = () => {
						order.push("note open");
						resolve();
					};
				}),
			};
			const { engine } = createEngine({
				commands: [step("Open note", "opens:note"), step("Next", "next:step")],
				registeredCommands: {
					"opens:note": opensNote,
					"next:step": { id: "next:step", name: "Next", callback: () => { order.push("next step"); } },
				},
			});

			const callback = opensNote.callback;
			const run = engine.run();
			await new Promise((resolve) => setTimeout(resolve, 20));
			expect(order).toEqual([]);

			finish();
			await run;
			expect(order).toEqual(["note open", "next step"]);
			// The registry entry is Obsidian's, so the wrapper must not outlive the call.
			expect(opensNote.callback).toBe(callback);
		});

		it("continues after the wait limit when the promise never settles, and says so", async () => {
			vi.useFakeTimers();
			const warn = vi.spyOn(log, "logWarning").mockImplementation(() => {});
			const next = vi.fn();
			const { engine } = createEngine({
				commands: [step("Never settles", "never:settles"), step("Next", "next:step")],
				registeredCommands: {
					"never:settles": { id: "never:settles", name: "Never settles", callback: () => new Promise(() => {}) },
					"next:step": { id: "next:step", name: "Next", callback: next },
				},
			});

			const run = engine.run();
			await vi.advanceTimersByTimeAsync(OBSIDIAN_COMMAND_WAIT_MS - 1);
			expect(next).not.toHaveBeenCalled();

			await vi.advanceTimersByTimeAsync(1);
			await run;
			expect(next).toHaveBeenCalledOnce();
			expect(warn).toHaveBeenCalledWith(
				"Obsidian command 'Never settles' was still running after 5 seconds. QuickAdd continued the macro without waiting for it.",
			);
		});

		it("reports a rejected command and runs the rest of the macro", async () => {
			const error = vi.spyOn(log, "logError").mockImplementation(() => {});
			const next = vi.fn();
			const { engine } = createEngine({
				commands: [step("Fails", "fails:cmd"), step("Next", "next:step")],
				registeredCommands: {
					"fails:cmd": { id: "fails:cmd", name: "Fails", callback: () => Promise.reject(new Error("disk full")) },
					"next:step": { id: "next:step", name: "Next", callback: next },
				},
			});

			await engine.run();

			expect(next).toHaveBeenCalledOnce();
			expect(String(error.mock.calls[0]?.[0])).toContain("disk full");
		});
	});
});
