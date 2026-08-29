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
	collectKind: StepRole["collect"]["kind"];
	cutsLaterCaptures: boolean;
}> = [
	{
		name: "Choice → Capture",
		type: CommandType.Choice,
		command: command(CommandType.Choice, { choiceId: "cap-1" }),
		resolve: resolveMap({ "cap-1": choiceStub("Capture", "cap-1") }),
		collectKind: "scanChoice",
		cutsLaterCaptures: false,
	},
	{
		name: "Choice → Macro",
		type: CommandType.Choice,
		command: command(CommandType.Choice, { choiceId: "macro-1" }),
		resolve: resolveMap({ "macro-1": choiceStub("Macro", "macro-1") }),
		collectKind: "none",
		cutsLaterCaptures: true,
	},
	{
		name: "Choice missing",
		type: CommandType.Choice,
		command: command(CommandType.Choice, { choiceId: "missing" }),
		resolve: noChoices(),
		collectKind: "none",
		cutsLaterCaptures: false,
	},
	{
		name: "NestedChoice Capture",
		type: CommandType.NestedChoice,
		command: command(CommandType.NestedChoice, {
			choice: choiceStub("Capture", "nested-cap"),
		}),
		collectKind: "scanChoice",
		cutsLaterCaptures: false,
	},
	{
		name: "NestedChoice Macro",
		type: CommandType.NestedChoice,
		command: command(CommandType.NestedChoice, {
			choice: choiceStub("Macro", "nested-macro"),
		}),
		collectKind: "none",
		cutsLaterCaptures: true,
	},
	{
		name: "NestedChoice Multi",
		type: CommandType.NestedChoice,
		command: command(CommandType.NestedChoice, {
			choice: choiceStub("Multi", "nested-multi"),
		}),
		collectKind: "none",
		cutsLaterCaptures: true,
	},
	{
		name: "UserScript",
		type: CommandType.UserScript,
		command: command(CommandType.UserScript, {
			path: "script.js",
			settings: {},
		}),
		collectKind: "scriptInputs",
		cutsLaterCaptures: true,
	},
	{
		name: "AIAssistant",
		type: CommandType.AIAssistant,
		command: command(CommandType.AIAssistant),
		collectKind: "none",
		cutsLaterCaptures: true,
	},
	{
		name: "Conditional",
		type: CommandType.Conditional,
		command: command(CommandType.Conditional, {
			thenCommands: [],
			elseCommands: [],
		}),
		collectKind: "none",
		cutsLaterCaptures: true,
	},
	{
		name: "Wait",
		type: CommandType.Wait,
		command: command(CommandType.Wait),
		collectKind: "none",
		cutsLaterCaptures: false,
	},
	{
		name: "Obsidian",
		type: CommandType.Obsidian,
		command: command(CommandType.Obsidian),
		collectKind: "none",
		cutsLaterCaptures: false,
	},
	{
		name: "EditorCommand",
		type: CommandType.EditorCommand,
		command: command(CommandType.EditorCommand),
		collectKind: "none",
		cutsLaterCaptures: false,
	},
	{
		name: "OpenFile",
		type: CommandType.OpenFile,
		command: command(CommandType.OpenFile),
		collectKind: "none",
		cutsLaterCaptures: false,
	},
];

describe("classifyStep", () => {
	it.each(TABLE)("$name", ({ command: cmd, resolve, collectKind, cutsLaterCaptures }) => {
		const role = classifyStep(cmd, resolve ?? noChoices());
		expect(role.collect.kind).toBe(collectKind);
		expect(Boolean(role.opaque)).toBe(cutsLaterCaptures);
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
		expect(role.opaque).toBeTruthy();
	});
});
