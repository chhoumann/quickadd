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
	])("FAILS, with an actionable message, for %s", async (_l, commands) => {
		// Before: `{"0":...}` reached `for..of` and surfaced a bare
		// "i is not iterable"; "not a list" reached it INTACT (strings are
		// iterable) so the macro reported success having run nothing at all.
		//
		// It throws rather than logging and returning, so `quickadd:run` reports
		// ok:false and automation cannot carry on as if the macro had run.
		await expect(
			runMacro({ id: "m", name: "M", commands }),
		).rejects.toThrow(/Could not read the commands for macro 'Test choice'/);
	});

	it("names data.json, so the message is actionable", async () => {
		await expect(
			runMacro({ id: "m", name: "M", commands: "not a list" }),
		).rejects.toThrow(/data\.json/);
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

	it("fails instead of skipping an unreadable branch silently", async () => {
		await expect(
			runMacro({
				id: "m",
				name: "M",
				commands: [conditional([], { "0": wait("hidden") })],
			}),
		).rejects.toThrow(/Could not read the else commands/);
	});

	// Returning would only exit executeConditional: the outer loop would run
	// every command AFTER the conditional, which were only ever meant to follow
	// a branch that never ran.
	it("does not run the commands after an unreadable conditional", async () => {
		const after = { id: "after", name: "Wait", type: CommandType.Wait, time: 1 };
		await expect(
			runMacro({
				id: "m",
				name: "M",
				commands: [conditional([], "not a list"), after],
			}),
		).rejects.toThrow(/Could not read the else commands/);
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
