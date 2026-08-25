import { describe, expect, it } from "vitest";
import type IChoice from "src/types/choices/IChoice";
import { CommandType } from "src/types/macros/CommandType";
import type { ICommand } from "src/types/macros/ICommand";
import { classifyStep, type StepRole } from "./macroCommandRole";

function choiceStub(
	type: IChoice["type"],
	id = `${type.toLowerCase()}-id`,
): IChoice {
	return { id, name: id, type, command: false };
}

function command(type: CommandType, extra: Record<string, unknown> = {}): ICommand {
	return {
		id: `${type}-cmd`,
		name: type,
		type,
		...extra,
	};
}

function noChoices(): (id: string) => IChoice | null {
	return () => null;
}

function resolveMap(
	choices: Record<string, IChoice | null>,
): (id: string) => IChoice | null {
	return (id) => (id in choices ? choices[id] : null);
}

const TABLE: Array<{
	name: string;
	type: CommandType;
	command: ICommand;
	resolve?: (id: string) => IChoice | null;
	expected: Partial<StepRole> & { collectKind: StepRole["collect"]["kind"] };
}> = [
	{
		name: "Choice → Capture",
		type: CommandType.Choice,
		command: command(CommandType.Choice, { choiceId: "cap-1" }),
		resolve: resolveMap({ "cap-1": choiceStub("Capture", "cap-1") }),
		expected: { collectKind: "scanChoice", opaque: null, deferred: null },
	},
	{
		name: "Choice → Macro",
		type: CommandType.Choice,
		command: command(CommandType.Choice, { choiceId: "macro-1" }),
		resolve: resolveMap({ "macro-1": choiceStub("Macro", "macro-1") }),
		expected: {
			collectKind: "none",
			opaque: null,
			deferred: "nestedMacroGroup",
		},
	},
	{
		name: "Choice missing",
		type: CommandType.Choice,
		command: command(CommandType.Choice, { choiceId: "missing" }),
		resolve: noChoices(),
		expected: {
			collectKind: "none",
			opaque: null,
			deferred: "unresolvableChoice",
		},
	},
	{
		name: "NestedChoice Capture",
		type: CommandType.NestedChoice,
		command: command(CommandType.NestedChoice, {
			choice: choiceStub("Capture", "nested-cap"),
		}),
		expected: { collectKind: "scanChoice", opaque: null, deferred: null },
	},
	{
		name: "NestedChoice Macro",
		type: CommandType.NestedChoice,
		command: command(CommandType.NestedChoice, {
			choice: choiceStub("Macro", "nested-macro"),
		}),
		expected: {
			collectKind: "none",
			opaque: null,
			deferred: "nestedMacroGroup",
		},
	},
	{
		name: "NestedChoice Multi",
		type: CommandType.NestedChoice,
		command: command(CommandType.NestedChoice, {
			choice: choiceStub("Multi", "nested-multi"),
		}),
		expected: {
			collectKind: "none",
			opaque: null,
			deferred: "interactivePicker",
		},
	},
	{
		name: "UserScript",
		type: CommandType.UserScript,
		command: command(CommandType.UserScript, {
			path: "script.js",
			settings: {},
		}),
		expected: {
			collectKind: "scriptInputs",
			opaque: "runsUserCode",
			deferred: null,
		},
	},
	{
		name: "AIAssistant",
		type: CommandType.AIAssistant,
		command: command(CommandType.AIAssistant),
		expected: {
			collectKind: "none",
			opaque: "runsUserCode",
			deferred: null,
		},
	},
	{
		name: "Conditional",
		type: CommandType.Conditional,
		command: command(CommandType.Conditional, {
			thenCommands: [],
			elseCommands: [],
		}),
		expected: {
			collectKind: "none",
			opaque: null,
			deferred: "conditionalBranch",
		},
	},
	{
		name: "Wait",
		type: CommandType.Wait,
		command: command(CommandType.Wait),
		expected: { collectKind: "none", opaque: null, deferred: null },
	},
	{
		name: "Obsidian",
		type: CommandType.Obsidian,
		command: command(CommandType.Obsidian),
		expected: { collectKind: "none", opaque: null, deferred: null },
	},
	{
		name: "EditorCommand",
		type: CommandType.EditorCommand,
		command: command(CommandType.EditorCommand),
		expected: { collectKind: "none", opaque: null, deferred: null },
	},
	{
		name: "OpenFile",
		type: CommandType.OpenFile,
		command: command(CommandType.OpenFile),
		expected: { collectKind: "none", opaque: null, deferred: null },
	},
];

describe("classifyStep", () => {
	it.each(TABLE)("$name", ({ command: cmd, resolve, expected }) => {
		const role = classifyStep(cmd, resolve ?? noChoices());
		expect(role.collect.kind).toBe(expected.collectKind);
		expect(role.opaque).toBe(expected.opaque ?? null);
		expect(role.deferred).toBe(expected.deferred ?? null);
	});

	it("covers every CommandType in the table", () => {
		const covered = new Set(TABLE.map((entry) => entry.type));
		for (const type of Object.values(CommandType)) {
			expect(covered.has(type)).toBe(true);
		}
	});

	it("does not walk a Conditional then-branch", () => {
		const nestedCapture = command(CommandType.NestedChoice, {
			choice: choiceStub("Capture", "then-cap"),
		});
		const role = classifyStep(
			command(CommandType.Conditional, {
				thenCommands: [nestedCapture],
				elseCommands: [],
			}),
			noChoices(),
		);
		expect(role.collect.kind).toBe("none");
		expect(role.deferred).toBe("conditionalBranch");
		expect(role.opaque).toBeNull();
	});
});
