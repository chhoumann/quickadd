import { describe, expect, it } from "vitest";
import type IChoice from "../../types/choices/IChoice";
import type ITemplateChoice from "../../types/choices/ITemplateChoice";
import { summarizeChoice } from "../../v3/choiceSummary";
import { lowerNode } from "../../v3/lower";
import { migrateChoice } from "../../v3/migrate";
import { availablePresets, createFromPreset, PRESET_GROUPS, PRESETS } from "./presets";

const EXPECTED: Record<string, string> = {
	log: "Adds a line under ## Log in today's daily note",
	task: "Adds a task under ## Tasks in today's daily note",
	addToNote: "Adds a line at the bottom of a chosen note",
	selection: "Adds the selection at the bottom of a chosen note",
	property: "Sets a chosen property in the current note",
	newNote: "Creates {title}, opens it",
	linkedNote: "Creates {title}, links it on a new line here, opens it",
	typedNote: "Creates {folder}/{title} from {Template}, opens it",
	script: "Runs a script",
	sequence: "No steps yet",
	ai: "Asks AI for {output}",
};

const CONTEXT = { templateFolder: "Meta/Templates" };

/** data.json's view of a choice, without the ids a fresh one gets at random. */
function stored(choice: IChoice): Record<string, unknown> {
	const plain = JSON.parse(JSON.stringify(choice)) as Record<string, unknown> & { macro?: { id?: string } };
	delete plain.id;
	// The builder's macro id is a second random id; a lowered macro reuses the choice's.
	if (plain.macro) delete plain.macro.id;
	return plain;
}

describe("presets", () => {
	it.each(PRESETS.map((preset) => [preset.id, preset] as const))("%s reads as intended", (id, preset) => {
		expect(summarizeChoice(preset.create(CONTEXT), [])).toBe(EXPECTED[id]);
	});

	it("offers every expected preset, in order", () => {
		expect(PRESETS.map((preset) => preset.id)).toEqual(Object.keys(EXPECTED));
	});

	it.each(PRESETS.map((preset) => [preset.id, preset] as const))(
		"%s migrates to an action without dropping or misreading anything",
		(_id, preset) => {
			const kinds = migrateChoice(preset.create(CONTEXT)).notes.map((note) => `${note.kind}: ${note.detail}`);
			expect(kinds).toEqual([]);
		},
	);

	it.each(PRESETS.map((preset) => [preset.id, preset] as const))(
		"%s survives the round trip through an action unchanged",
		(_id, preset) => {
			const choice = preset.create(CONTEXT);
			expect(stored(lowerNode(migrateChoice(choice).node))).toEqual(stored(choice));
		},
	);

	it("groups every preset, in the menu's group order", () => {
		const order = PRESET_GROUPS.map((group) => group.id);
		const groups = PRESETS.map((preset) => order.indexOf(preset.group));
		expect(groups.every((index) => index >= 0)).toBe(true);
		expect(groups).toEqual([...groups].sort((a, b) => a - b));
		expect(PRESET_GROUPS.map((group) => group.label)).toEqual(["Add to a note", "Create a note", "Automate"]);
	});

	it("leaves out Ask AI while online features are off", () => {
		expect(availablePresets(false).map((preset) => preset.id)).toContain("ai");
		expect(availablePresets(true).map((preset) => preset.id)).toEqual(Object.keys(EXPECTED).filter((id) => id !== "ai"));
	});

	it("picks the type's template from the template folder at run time", () => {
		const choice = PRESETS.find((preset) => preset.id === "typedNote")!.create(CONTEXT) as ITemplateChoice;
		expect(choice.templatePath).toBe("{{FILE:Meta/Templates|path|label:Template}}");
	});

	it("names every preset differently", () => {
		const names = PRESETS.map((preset) => preset.name);
		expect(new Set(names).size).toBe(names.length);
	});

	it("adds every preset's choice asking for its inputs on one page", () => {
		for (const preset of PRESETS) expect(createFromPreset(preset, CONTEXT).onePageInput).toBe("always");
	});

	it("leaves a sequence's step to follow its sequence", () => {
		for (const preset of PRESETS) expect(preset.create(CONTEXT).onePageInput).toBeUndefined();
	});

	it("names the choice after the preset", () => {
		for (const preset of PRESETS) expect(preset.create(CONTEXT).name).toBe(preset.name);
	});
});
