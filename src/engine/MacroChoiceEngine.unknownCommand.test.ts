import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../quickAddApi", () => ({ QuickAddApi: { GetApi: () => ({}) } }));
vi.mock("../formatters/completeFormatter", () => ({
	CompleteFormatter: class CompleteFormatterMock {},
}));
vi.mock("obsidian-dataview", () => ({ getAPI: vi.fn() }));
vi.mock("../main", () => ({ default: class QuickAddMock {} }));

import type { App } from "obsidian";
import type IMacroChoice from "../types/choices/IMacroChoice";
import type { IChoiceExecutor } from "../IChoiceExecutor";
import type { ICommand } from "../types/macros/ICommand";
import { CommandType } from "../types/macros/CommandType";
import { MacroChoiceEngine } from "./MacroChoiceEngine";
import { log } from "../logger/logManager";
import { settingsStore } from "../settingsStore";

const OBSIDIAN_COMMAND_ID = "app:go-back";

/**
 * An Obsidian command is the cheapest "did the macro carry on?" probe: it is
 * synchronous, needs no vault, and lands on a spy.
 */
function obsidianCommand(id: string, name = "Marker"): ICommand {
	return {
		id,
		name,
		type: CommandType.Obsidian,
		commandId: OBSIDIAN_COMMAND_ID,
	} as unknown as ICommand;
}

function buildEngine(commands: unknown[], variables: Record<string, unknown> = {}) {
	const executeCommandById = vi.fn();
	const app = {
		commands: {
			executeCommandById,
			commands: { [OBSIDIAN_COMMAND_ID]: { id: OBSIDIAN_COMMAND_ID } },
		},
	} as unknown as App;

	const choice = {
		id: "choice-id",
		name: "Test choice",
		type: "Macro",
		command: false,
		runOnStartup: false,
		macro: { id: "macro-id", name: "Test macro", commands },
	} as unknown as IMacroChoice;

	const choiceExecutor: IChoiceExecutor = {
		execute: vi.fn(),
		variables: new Map<string, unknown>(),
	};

	const engine = new MacroChoiceEngine(
		app,
		{ settings: settingsStore.getState() } as never,
		choice,
		choiceExecutor,
		new Map<string, unknown>(Object.entries(variables)),
	);

	return { engine, executeCommandById };
}

function runMacro(commands: unknown[], variables: Record<string, unknown> = {}) {
	const { engine, executeCommandById } = buildEngine(commands, variables);
	return { run: engine.run(), executeCommandById };
}

/**
 * The dispatch loop used to be a flat `if (isX(command))` chain with no else,
 * so a command type it did not know was dropped with no error, no notice and
 * no log, and the macro still reported success (#1571). The step after it then
 * inherited the hole - an unset output variable turns into a mid-macro prompt
 * asking the user to type the value the skipped step was supposed to produce.
 */
describe("MacroChoiceEngine over a command type it cannot run (#1571)", () => {
	let errors: string[];

	beforeEach(() => {
		errors = [];
		vi.spyOn(log, "logError").mockImplementation((msg: string | Error) => {
			errors.push(msg instanceof Error ? msg.message : msg);
		});
	});

	it("says so, instead of dropping the step silently", async () => {
		const { run } = runMacro([
			{ id: "c1", name: "From a newer QuickAdd", type: "SomeFutureThing" },
		]);
		await run;

		expect(errors).toHaveLength(1);
		expect(errors[0]).toContain("From a newer QuickAdd");
		expect(errors[0]).toContain("SomeFutureThing");
		expect(errors[0]).toContain("Test choice");
	});

	it("points at the three ways an unrunnable command actually arrives", async () => {
		// A hand-edited data.json, an imported package, and - the one our own
		// downgrade recipe produces - a data.json written by a NEWER QuickAdd.
		const { run } = runMacro([
			{ id: "c1", name: "Mystery", type: "SomeFutureThing" },
		]);
		await run;

		expect(errors[0]).toMatch(/newer version of QuickAdd/i);
		expect(errors[0]).toMatch(/imported package/i);
		expect(errors[0]).toMatch(/data\.json/);
	});

	it("carries on with the rest of the macro rather than aborting it", async () => {
		// Skipping is the safer half: the step did nothing either way, and
		// aborting would take the file-writing steps that DID work with it.
		const { run, executeCommandById } = runMacro([
			{ id: "c1", name: "Mystery", type: "SomeFutureThing" },
			obsidianCommand("c2"),
		]);
		await run;

		expect(executeCommandById).toHaveBeenCalledWith(OBSIDIAN_COMMAND_ID);
		expect(errors).toHaveLength(1);
	});

	it("tells the truth about a retired type, not the newer-version guess", async () => {
		// A real legacy string, exactly as 2.19.x and earlier wrote it. The
		// generic message would say it "can come from a newer version of
		// QuickAdd" - the opposite of the truth for a type we removed ourselves.
		const { run, executeCommandById } = runMacro([
			{
				id: "c1",
				name: "Summarise",
				type: "InfiniteAIAssistant",
				model: "gpt-4",
				outputVariableName: "out",
			},
			obsidianCommand("c2"),
		]);
		await run;

		expect(errors).toHaveLength(1);
		expect(errors[0]).toContain("Summarise");
		expect(errors[0]).toMatch(/Infinite AI Assistant/i);
		expect(errors[0]).toContain("chunkedPrompt");
		expect(errors[0]).not.toMatch(/newer version/i);
		expect(executeCommandById).toHaveBeenCalledWith(OBSIDIAN_COMMAND_ID);
	});

	it("shouts from inside a conditional branch too", async () => {
		// Branches recurse through the same loop, so the hole was there as well.
		const { run } = runMacro(
			[
				{
					id: "cond",
					name: "If condition",
					type: CommandType.Conditional,
					condition: {
						mode: "variable",
						variableName: "go",
						operator: "isTruthy",
						valueType: "string",
					},
					thenCommands: [
						{ id: "c1", name: "Mystery", type: "SomeFutureThing" },
					],
					elseCommands: [],
				},
			],
			{ go: "yes" },
		);
		await run;

		expect(errors).toHaveLength(1);
		expect(errors[0]).toContain("Mystery");
	});

	it("never quotes a type it does not have", async () => {
		// A truncated write or a hand-authored package step can leave an entry with
		// no type at all, a non-string one, or no object at all. Quoting
		// `'undefined'` (or `'[object Object]'`) would send the user hunting for a
		// command type that never existed - but staying silent would be the very
		// hole this change closes, so each of these still gets said out loud.
		const { run } = runMacro([
			{ id: "c1", name: "Half a command" },
			{ id: "c2", name: "Weird", type: { nested: true } },
			5,
			"Wait",
		]);
		await run;

		expect(errors).toHaveLength(4);
		for (const message of errors) {
			expect(message).toMatch(/has no command type/);
			expect(message).not.toMatch(/undefined|\[object Object\]/);
		}
	});

	it("does not quote a name it does not have either", async () => {
		// A hand-authored package step can omit `name`. `'undefined'` in the
		// notice is the same class of lie as quoting a type that is not there.
		const { run } = runMacro([{ id: "c1", type: "SomeFutureThing" }]);
		await run;

		expect(errors).toHaveLength(1);
		expect(errors[0]).toContain("an unnamed command");
		expect(errors[0]).not.toMatch(/undefined/);
	});

	it("skips an unknown editor command instead of aborting the macro", async () => {
		// Editor commands dispatch through their own switch, which used to THROW
		// on an unknown type and take the whole macro down. Same threat model as
		// the outer loop - a newer QuickAdd adding an EditorCommandType - so it
		// gets the same answer.
		const { run, executeCommandById } = runMacro([
			{
				id: "c1",
				name: "Fold everything",
				type: CommandType.EditorCommand,
				editorCommandType: "FoldEverything",
			},
			obsidianCommand("c2"),
		]);
		await run;

		expect(errors).toHaveLength(1);
		expect(errors[0]).toContain("FoldEverything");
		expect(errors[0]).toContain("editor command type");
		expect(executeCommandById).toHaveBeenCalledWith(OBSIDIAN_COMMAND_ID);
	});

	it("skips a null entry without a notice - corruption is not a command", async () => {
		// `packageImportService` guards for exactly this shape, and a red notice
		// per hole would bury the settings-resilience work (#1583) under noise.
		const { run, executeCommandById } = runMacro([
			null,
			undefined,
			obsidianCommand("c2"),
		]);
		await run;

		expect(errors).toEqual([]);
		expect(executeCommandById).toHaveBeenCalledWith(OBSIDIAN_COMMAND_ID);
	});

	it("guards runSubset too, which is a public entry of its own", async () => {
		const { engine } = buildEngine([]);
		await engine.runSubset([
			{ id: "c1", name: "Mystery", type: "SomeFutureThing" },
		] as unknown as ICommand[]);

		expect(errors).toHaveLength(1);
		expect(errors[0]).toContain("SomeFutureThing");
	});

	it("still runs the types it does know, exactly once each", async () => {
		const { run, executeCommandById } = runMacro([
			obsidianCommand("c1", "First"),
			{ id: "c2", name: "Wait", type: CommandType.Wait, time: 1 },
			obsidianCommand("c3", "Second"),
		]);
		await run;

		expect(executeCommandById).toHaveBeenCalledTimes(2);
		expect(errors).toEqual([]);
	});
});
