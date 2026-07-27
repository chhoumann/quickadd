import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../formatters/completeFormatter", () => ({
	CompleteFormatter: class CompleteFormatterMock {},
}));
vi.mock("obsidian-dataview", () => ({ getAPI: vi.fn() }));
vi.mock("../main", () => ({ default: class QuickAddMock {} }));

import type { App } from "obsidian";
import type IMacroChoice from "../types/choices/IMacroChoice";
import type { IChoiceExecutor } from "../IChoiceExecutor";
import { CommandType } from "../types/macros/CommandType";
import { MacroChoiceEngine } from "./MacroChoiceEngine";
import { log } from "../logger/logManager";
import { settingsStore } from "../settingsStore";

function runMacro(macro: unknown) {
	const choice = {
		id: "choice-id",
		name: "Test choice",
		type: "Macro",
		command: false,
		runOnStartup: false,
		macro,
	} as unknown as IMacroChoice;
	const choiceExecutor: IChoiceExecutor = {
		execute: vi.fn(),
		variables: new Map<string, unknown>(),
	};
	return new MacroChoiceEngine(
		{} as App,
		{ settings: settingsStore.getState() } as never,
		choice,
		choiceExecutor,
		new Map<string, unknown>(),
	).run();
}

const wait = (id: string, time = 1) => ({
	id,
	name: "Wait",
	type: CommandType.Wait,
	time,
});

/**
 * The run path, over the same malformed shapes the macro EDITOR handles
 * (#1593). Two of them were broken outside the UI entirely, because the old
 * guard was a truthiness test.
 */
describe("MacroChoiceEngine.run over a malformed command list (#1593)", () => {
	let errors: string[];

	beforeEach(() => {
		errors = [];
		vi.spyOn(log, "logError").mockImplementation((msg: string) => {
			errors.push(msg);
		});
	});

	it.each([
		["an array-turned-object", { "0": wait("hidden") }],
		["a string", "not a list"],
		["a number", 7],
	])("says it could not read %s, instead of throwing or lying", async (_l, commands) => {
		// Before: `{"0":...}` reached `for..of` and surfaced a bare
		// "i is not iterable"; "not a list" reached it INTACT (strings are
		// iterable) so the macro reported success having run nothing at all.
		await expect(
			runMacro({ id: "m", name: "M", commands }),
		).resolves.toBeUndefined();

		expect(errors).toHaveLength(1);
		expect(errors[0]).toContain("Could not read the commands for macro");
		expect(errors[0]).toContain("Test choice");
		expect(errors[0]).toContain("data.json");
	});

	// `commands: []` is what QuickAddMacro's constructor produces, so every
	// freshly created macro - and every launch with an unpopulated run-on-startup
	// macro - would otherwise raise a 15-second red notice.
	it("stays silent for an empty list, which is the healthy default", async () => {
		await runMacro({ id: "m", name: "M", commands: [] });
		expect(errors).toEqual([]);
	});

	it.each([
		["commands is null", { id: "m", name: "M", commands: null }],
		["commands is absent", { id: "m", name: "M" }],
		["the macro is missing", null],
	])("reports a missing macro when %s", async (_label, macro) => {
		await runMacro(macro);
		expect(errors).toEqual([
			"No commands in the macro for choice 'Test choice'",
		]);
	});

	it("runs the real commands either side of a hole", async () => {
		await expect(
			runMacro({ id: "m", name: "M", commands: [wait("a"), null, wait("b")] }),
		).resolves.toBeUndefined();
		expect(errors).toEqual([]);
	});
});

describe("MacroChoiceEngine conditional branches over a malformed value (#1593)", () => {
	let errors: string[];

	beforeEach(() => {
		errors = [];
		vi.spyOn(log, "logError").mockImplementation((msg: string) => {
			errors.push(msg);
		});
		vi.spyOn(log, "logWarning").mockImplementation(() => {});
	});

	const conditional = (thenCommands: unknown, elseCommands: unknown) => ({
		id: "cond",
		name: "If",
		type: CommandType.Conditional,
		// An undefined variable evaluates false, so the ELSE branch is taken.
		condition: {
			mode: "variable",
			variableName: "undefinedVar",
			operator: "isTruthy",
			valueType: "string",
		},
		thenCommands,
		elseCommands,
	});

	it("says it could not read the branch instead of skipping it silently", async () => {
		await runMacro({
			id: "m",
			name: "M",
			commands: [conditional([], { "0": wait("hidden") })],
		});

		expect(errors).toHaveLength(1);
		expect(errors[0]).toContain("Could not read the else commands");
	});

	// A conditional with no else branch is entirely normal, and must stay quiet.
	it.each([
		["an empty array", []],
		["undefined", undefined],
		["null", null],
	])("stays silent for a branch that is %s", async (_label, elseCommands) => {
		await runMacro({
			id: "m",
			name: "M",
			commands: [conditional([], elseCommands)],
		});
		expect(errors).toEqual([]);
	});
});
