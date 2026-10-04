import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { CaptureChoice } from "../../src/types/choices/CaptureChoice";
import type IChoice from "../../src/types/choices/IChoice";
import { MacroChoice } from "../../src/types/choices/MacroChoice";
import { ObsidianCommand } from "../../src/types/macros/ObsidianCommand";
import { MultiChoice } from "../../src/types/choices/MultiChoice";
import { TemplateChoice } from "../../src/types/choices/TemplateChoice";
import { V2_CHOICE_KEYS, migrateSettingsV2 } from "../../src/v3/migrate";
import type { ActionNode, Step } from "../../src/v3/model";
import { actionsFromChoices, choicesFromActions } from "../../src/v3/storage";
import { CommandType } from "../../src/types/macros/CommandType";
import type IMacroChoice from "../../src/types/choices/IMacroChoice";
import type IMultiChoice from "../../src/types/choices/IMultiChoice";
import type { ICommand } from "../../src/types/macros/ICommand";
import { threeWayMergeSettings } from "../../src/utils/settingsPersistMerge";
import { FIXTURE } from "./fixture";
import { packageChoices } from "./packages";

const migrated = { migrations: { migrateToV3Actions: true } };
const extraConfigs = (process.env.QUICKADD_V3_EXTRA_CONFIGS ?? "").split(":").filter(Boolean);
const configs: [string, IChoice[]][] = [
	["packages and fixture", [...FIXTURE, ...packageChoices().map(({ choice }) => choice)]],
	...extraConfigs.map((file): [string, IChoice[]] => [file, JSON.parse(readFileSync(file, "utf8")).choices]),
];

type Loaded = typeof migrated & { choices: IChoice[]; actions: ActionNode[] };

/** data.json after loading it, applying `edit` to the loaded choices, and saving it again. */
const loadAndSave = (disk: object, edit: (choices: IChoice[]) => void = () => {}) => {
	const loaded = choicesFromActions(JSON.parse(JSON.stringify(disk))) as Loaded;
	edit(loaded.choices);
	return JSON.parse(JSON.stringify(actionsFromChoices(loaded)));
};

const stored = (choices: IChoice[]) => JSON.parse(JSON.stringify(migrateSettingsV2({ ...migrated, choices })));

/**
 * Gives every action and step what no v2 choice can hold: actions show in the
 * ribbon, and every node and step carries a field a later QuickAdd could have
 * written.
 */
function withV3Fields(nodes: ActionNode[]): ActionNode[] {
	const steps = (list: Step[]): Step[] =>
		list.map((step) => {
			const own = { ...step, laterStepField: `kept on ${step.id}` } as unknown as Step;
			if (own.type === "if") return { ...own, thenSteps: steps(own.thenSteps), elseSteps: steps(own.elseSteps) };
			if (own.type === "inlineAction") return { ...own, node: withV3Fields([own.node])[0] };
			return own;
		});
	return nodes.map((node) =>
		node.kind === "folder"
			? { ...node, laterFolderField: true, items: withV3Fields(node.items) }
			: { ...node, show: { ...node.show, ribbon: true }, laterField: { since: "3.1" }, steps: steps(node.steps) },
	);
}

/** The choices of the action tree: root choices and folder children, not the steps of a macro. */
function treeChoices(choices: IChoice[]): IChoice[] {
	return choices.flatMap((choice) =>
		choice.type === "Multi" ? [choice, ...treeChoices((choice as IMultiChoice).choices ?? [])] : [choice],
	);
}

function renameNodes(nodes: ActionNode[]): ActionNode[] {
	return nodes.map((node) => ({
		...node,
		name: `${node.name} (edited)`,
		...(node.kind === "folder" ? { items: renameNodes(node.items) } : {}),
	}));
}

describe("the lowered view of stored actions", () => {
	it.each(configs)("saves what it loaded unchanged: %s", (_name, choices) => {
		const disk = JSON.parse(JSON.stringify(migrateSettingsV2({ ...migrated, choices })));
		expect(loadAndSave(disk)).toEqual(disk);
	});

	it.each(configs)("keeps what only an action holds through an edit to its choice: %s", (_name, choices) => {
		const disk = stored(choices);
		disk.actions = withV3Fields(disk.actions);
		const saved = loadAndSave(disk, (loaded) => {
			for (const choice of treeChoices(loaded)) choice.name = `${choice.name} (edited)`;
		});
		expect(saved).toEqual({ ...disk, actions: renameNodes(disk.actions) });
	});

	it("saves what it loaded unchanged, ribbon and unknown fields included", () => {
		const disk = stored(FIXTURE);
		disk.actions = withV3Fields(disk.actions);
		expect(loadAndSave(disk)).toEqual(disk);
	});

	it("merges a macro's steps by id: kept steps keep their own fields, in the order the builder left them", () => {
		const macro = new MacroChoice("Morning");
		macro.id = "m";
		const script = { id: "s1", name: "script", type: CommandType.UserScript, path: "a.js", settings: {} };
		const wait = { id: "w1", name: "Wait", type: CommandType.Wait, time: 10 };
		const command = { id: "o1", name: "Bold", type: CommandType.Obsidian, commandId: "editor:toggle-bold" };
		macro.macro.commands = [script, wait, command] as ICommand[];
		const disk = stored([macro]);
		disk.actions = withV3Fields(disk.actions);

		const saved = loadAndSave(disk, ([loaded]) => {
			const [s1, , o1] = (loaded as IMacroChoice).macro.commands;
			const added = { id: "w2", name: "Wait", type: CommandType.Wait, time: 5 } as ICommand;
			(loaded as IMacroChoice).macro.commands = [o1, added, { ...s1, path: "b.js" } as ICommand];
		});

		expect(saved.actions[0].steps).toEqual([
			{ id: "o1", name: "Bold", type: "runCommand", command: { kind: "obsidian", commandId: "editor:toggle-bold" }, laterStepField: "kept on o1" },
			{ id: "w2", name: "Wait", type: "wait", time: 5 },
			{ id: "s1", name: "script", type: "runScript", path: "b.js", settings: {}, laterStepField: "kept on s1" },
		]);
		expect(saved.actions[0]).toMatchObject({ show: { ribbon: true }, laterField: { since: "3.1" } });
	});

	it("adds an action for a new choice and removes the action of a removed choice", () => {
		const disk = stored(FIXTURE.slice(0, 3));
		disk.actions = withV3Fields(disk.actions);
		const added = new CaptureChoice("Added");
		const saved = loadAndSave(disk, (loaded) => {
			loaded.splice(1, 1);
			loaded.push(added);
		});
		expect(saved.actions.map((action: ActionNode) => action.id)).toEqual([FIXTURE[0].id, FIXTURE[2].id, added.id]);
		expect(saved.actions[2]).not.toHaveProperty("laterField");
		expect(saved.actions[1]).toMatchObject({ show: { ribbon: true }, laterField: { since: "3.1" } });
	});

	it("keeps what only an action holds when a settings merge brings an edit from another device", () => {
		const base = stored(FIXTURE.slice(0, 3));
		// This device renamed the first choice in the builder.
		const local = loadAndSave(base, (loaded) => {
			loaded[0].name = "Renamed here";
		});
		// The other device showed the second action in the ribbon and changed
		// the third one's format, with a field this build does not know.
		const disk = structuredClone(base);
		disk.actions[1] = { ...disk.actions[1], show: { ...disk.actions[1].show, ribbon: true }, laterField: 1 };
		disk.actions[2].steps[0].format = { enabled: true, format: "- elsewhere {{VALUE}}" };

		const merged = threeWayMergeSettings(base, local, disk);
		expect(merged.actions[0].name).toBe("Renamed here");
		expect(merged.actions[1]).toMatchObject({ show: { ribbon: true }, laterField: 1 });
		expect(merged.actions[2].steps[0].format.format).toBe("- elsewhere {{VALUE}}");
		// And the next save of what the merge loads keeps all three.
		expect(loadAndSave(merged)).toEqual(merged);
	});

	it("merges edits to different steps of one macro made on two devices", () => {
		const macro = new MacroChoice("Morning");
		macro.macro.commands = [
			{ id: "s1", name: "script", type: CommandType.UserScript, path: "a.js", settings: {} },
			{ id: "w1", name: "Wait", type: CommandType.Wait, time: 10 },
		] as unknown as ICommand[];
		const base = stored([macro]);
		const local = loadAndSave(base, ([loaded]) => {
			((loaded as IMacroChoice).macro.commands[0] as unknown as { path: string }).path = "here.js";
		});
		const disk = structuredClone(base);
		disk.actions[0].steps[1].time = 99;
		const merged = threeWayMergeSettings(base, local, disk);
		expect(merged.actions[0].steps.map((step: { path?: string; time?: number }) => step.path ?? step.time)).toEqual(["here.js", 99]);
	});

	it("saves an edit made to a loaded choice into its action", () => {
		const disk = JSON.parse(JSON.stringify(migrateSettingsV2({ ...migrated, choices: FIXTURE })));
		const loaded = choicesFromActions(disk) as { choices: IChoice[] };
		loaded.choices.find((choice) => choice.id === "fx-top")!.name = "Renamed";
		const saved = actionsFromChoices({ ...migrated, ...loaded }) as { actions: { id: string; name: string }[] };
		expect(saved.actions.find((action) => action.id === "fx-top")?.name).toBe("Renamed");
		expect(saved).not.toHaveProperty("choices");
	});

	it("saves choices the builder made, class instances with methods included", () => {
		const macro = new MacroChoice("Run a command");
		macro.macro.commands = [new ObsidianCommand("Toggle bold", "editor:toggle-bold")];
		const saved = actionsFromChoices({ ...migrated, choices: [macro] }) as { actions: { steps: unknown[] }[] };
		expect(saved.actions[0].steps).toMatchObject([{ type: "runCommand", command: { kind: "obsidian", commandId: "editor:toggle-bold" } }]);
	});

	it("keeps choices a QuickAdd 2 device saved next to the actions, once each", () => {
		const disk = JSON.parse(JSON.stringify(migrateSettingsV2({ ...migrated, choices: FIXTURE.slice(0, 2) })));
		const added = new CaptureChoice("Added on a 2.x device");
		disk.choices = [FIXTURE[0], added];
		const loaded = choicesFromActions(disk) as { choices: IChoice[] };
		expect(loaded.choices.map((choice) => choice.id)).toEqual([FIXTURE[0].id, FIXTURE[1].id, added.id]);
	});

	it("writes back an unreadable action list as it found it", () => {
		const disk = { ...migrated, actions: { 0: { id: "x" } } };
		expect(loadAndSave(disk)).toEqual(disk);
	});

	it("saves choices until they were migrated", () => {
		const settings = { migrations: { migrateToV3Actions: false }, choices: FIXTURE };
		expect(actionsFromChoices(settings)).toBe(settings);
		expect(choicesFromActions(settings)).toBe(settings);
	});

	it("knows every setting a new v2 choice starts with, so saving keeps them", () => {
		const choices = [new TemplateChoice("t"), new CaptureChoice("c"), new MacroChoice("m"), new MultiChoice("f")];
		for (const choice of choices) {
			expect(Object.keys(choice).filter((key) => !V2_CHOICE_KEYS[choice.type].has(key)), choice.type).toEqual([]);
		}
	});
});
