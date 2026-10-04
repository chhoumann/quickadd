import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { CaptureChoice } from "../../src/types/choices/CaptureChoice";
import type IChoice from "../../src/types/choices/IChoice";
import { MacroChoice } from "../../src/types/choices/MacroChoice";
import { ObsidianCommand } from "../../src/types/macros/ObsidianCommand";
import { MultiChoice } from "../../src/types/choices/MultiChoice";
import { TemplateChoice } from "../../src/types/choices/TemplateChoice";
import { V2_CHOICE_KEYS, migrateSettingsV2 } from "../../src/v3/migrate";
import { actionsFromChoices, choicesFromActions } from "../../src/v3/storage";
import { FIXTURE } from "./fixture";
import { packageChoices } from "./packages";

const migrated = { migrations: { migrateToV3Actions: true } };
const extraConfigs = (process.env.QUICKADD_V3_EXTRA_CONFIGS ?? "").split(":").filter(Boolean);
const configs: [string, IChoice[]][] = [
	["packages and fixture", [...FIXTURE, ...packageChoices().map(({ choice }) => choice)]],
	...extraConfigs.map((file): [string, IChoice[]] => [file, JSON.parse(readFileSync(file, "utf8")).choices]),
];

/** data.json after loading it and saving it again with no edits. */
const loadAndSave = (disk: object) =>
	JSON.parse(JSON.stringify(actionsFromChoices(choicesFromActions(disk) as typeof migrated & { choices: unknown })));

describe("the lowered view of stored actions", () => {
	it.each(configs)("saves what it loaded unchanged: %s", (_name, choices) => {
		const disk = JSON.parse(JSON.stringify(migrateSettingsV2({ ...migrated, choices })));
		expect(loadAndSave(disk)).toEqual(disk);
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
