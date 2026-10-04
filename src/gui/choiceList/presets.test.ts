import { describe, expect, it } from "vitest";
import type IChoice from "../../types/choices/IChoice";
import { summarizeChoice } from "../../v3/choiceSummary";
import { lowerNode } from "../../v3/lower";
import { migrateChoice } from "../../v3/migrate";
import { PRESETS } from "./presets";

const EXPECTED: Record<string, string> = {
	log: "Adds a line under ## Log in today's daily note",
	addToNote: "Adds a line at the bottom of a chosen note",
	task: "Adds a task under ## Tasks in today's daily note",
	newNote: "Creates {title}",
	linkedNote: "Creates {title}, links it here, opens it",
	sequence: "No steps yet",
};

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
		expect(summarizeChoice(preset.create(), [])).toBe(EXPECTED[id]);
	});

	it("offers every expected preset, in order", () => {
		expect(PRESETS.map((preset) => preset.id)).toEqual(Object.keys(EXPECTED));
	});

	it.each(PRESETS.map((preset) => [preset.id, preset] as const))(
		"%s migrates to an action without dropping or misreading anything",
		(_id, preset) => {
			const kinds = migrateChoice(preset.create()).notes.map((note) => `${note.kind}: ${note.detail}`);
			expect(kinds).toEqual([]);
		},
	);

	it.each(PRESETS.map((preset) => [preset.id, preset] as const))(
		"%s survives the round trip through an action unchanged",
		(_id, preset) => {
			const choice = preset.create();
			expect(stored(lowerNode(migrateChoice(choice).node))).toEqual(stored(choice));
		},
	);

	it("names every preset differently", () => {
		const names = PRESETS.map((preset) => preset.name);
		expect(new Set(names).size).toBe(names.length);
	});

	it("names the choice after the preset", () => {
		for (const preset of PRESETS) expect(preset.create().name).toBe(preset.name);
	});
});
