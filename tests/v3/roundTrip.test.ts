import { describe, expect, it } from "vitest";
import type IChoice from "../../src/types/choices/IChoice";
import { legacyTypeOf, lowerNode } from "../../src/v3/lower";
import { buildReport, migrateChoice, migrateSettingsV2 } from "../../src/v3/migrate";
import type { Action } from "../../src/v3/model";
import { canon } from "./canon";
import { FIXTURE } from "./fixture";
import { packageChoices } from "./packages";

const packaged = packageChoices();
const cases: [string, IChoice][] = [
	...packaged.map(({ pkg, choice }): [string, IChoice] => [`${pkg}: ${choice.name}`, choice]),
	...FIXTURE.map((choice): [string, IChoice] => [`fixture: ${choice.name}`, choice]),
];

describe("lowerNode(migrateChoice(c)) equals canon(c)", () => {
	it("reads all 20 docs packages", () => {
		expect(new Set(packaged.map(({ pkg }) => pkg)).size).toBe(20);
	});

	it.each(cases)("%s", (_name, choice) => {
		expect(lowerNode(migrateChoice(choice).node)).toEqual(canon(choice));
	});

	it("keeps the v2 type of every choice", () => {
		for (const [, choice] of cases) {
			expect(legacyTypeOf(migrateChoice(choice).node)).toBe(choice.type);
		}
	});

	it("does not modify its input", () => {
		const input = structuredClone(FIXTURE);
		for (const choice of input) migrateChoice(choice);
		expect(input).toEqual(FIXTURE);
	});
});

describe("determinism", () => {
	const settings = { choices: [...FIXTURE, ...packaged.map(({ choice }) => choice)], devMode: false };

	it("migrates to byte-identical JSON every time", () => {
		expect(JSON.stringify(migrateSettingsV2(structuredClone(settings))))
			.toBe(JSON.stringify(migrateSettingsV2(structuredClone(settings))));
	});

	it("leaves migrated settings unchanged", () => {
		const migrated = migrateSettingsV2(structuredClone(settings));
		const again = migrateSettingsV2(migrated);
		expect(JSON.stringify(again)).toBe(JSON.stringify(migrated));
		expect(again).not.toHaveProperty("choices");
	});
});

describe("migration shape", () => {
	const node = (id: string) => migrateChoice(FIXTURE.find((choice) => choice.id === id) as IChoice).node as Action;

	it("inlines a nested Template and Capture and keeps the rest nested", () => {
		const macro = node("fx-macro");
		expect(macro.steps.map((step) => step.type)).toEqual([
			"runCommand", "runCommand", "runScript", "runAction", "runAction", "wait", "ai",
			"open", "open", "open",
			"createNote", "open",
			"runCommand",
			"addToNote", "templater", "link",
			"if",
			"inlineAction", "inlineAction", "inlineAction", "inlineAction",
			"unknown",
		]);
		expect(macro.steps.find((step) => step.id === "fx-nested-capture")).toMatchObject({ name: "Nested capture" });
	});

	it("puts a Capture's follow-ups in run order on the run note", () => {
		expect(node("fx-capture-everything").steps).toMatchObject([
			{ id: "fx-capture-everything", type: "addToNote", position: "top" },
			{ id: "fx-capture-everything:templater", type: "templater", note: "{{NOTE}}" },
			{ id: "fx-capture-everything:link", type: "link", link: "{{NOTE}}", copyToClipboard: true, insert: { placement: "replaceSelection" } },
			{ id: "fx-capture-everything:open", type: "open", note: "{{NOTE}}", location: "window", mode: "preview" },
		]);
	});

	it("names the position the engine runs, not the switches", () => {
		const positions = Object.fromEntries(
			["fx-top", "fx-bottom", "fx-bottom-and-after", "fx-all-switches", "fx-cursor", "fx-active-top",
				"fx-active-bottom-legacy", "fx-active-top-and-prepend", "fx-line-above", "fx-active-after", "fx-property"]
				.map((id) => [id, (node(id).steps[0] as { position: string }).position]),
		);
		expect(positions).toEqual({
			"fx-top": "top",
			"fx-bottom": "bottom",
			"fx-bottom-and-after": "bottom",
			"fx-all-switches": "bottom",
			"fx-cursor": "cursor",
			"fx-active-top": "top",
			"fx-active-bottom-legacy": "bottom",
			"fx-active-top-and-prepend": "top",
			"fx-line-above": "newLineAbove",
			"fx-active-after": "bottom",
			"fx-property": "property",
		});
	});
});

describe("report", () => {
	it("lists what the migration decided", () => {
		const report = buildReport({ choices: FIXTURE });
		const kinds = (kind: string) => report.notes.filter((note) => note.kind === kind).map((note) => `${note.choiceId}: ${note.detail}`);
		expect(kinds("keptNested")).toEqual([
			"fx-macro: 'Nested macro' (fx-nested-macro) because of a nested Macro",
			"fx-macro: 'Pick one' (fx-nested-multi) because of a nested Multi",
			"fx-macro: 'Tomorrow's note' (fx-nested-dated) because of its own dateOrigin",
			"fx-macro: 'Inner name' (fx-nested-renamed) because of a step name that differs from the choice name",
		]);
		expect(kinds("templaterRerun")).toEqual(["fx-macro: step c-rerun runs Templater again after a write"]);
		expect(kinds("danglingRunAction")).toEqual(["fx-macro: step c-dangling runs missing fx-missing"]);
		expect(kinds("unknownCommand")).toEqual(["fx-macro: step c-future has unknown type 'FutureStep'"]);
		expect(kinds("writePositionConflict").map((line) => line.split(":")[0])).toEqual([
			"fx-bottom-and-after", "fx-all-switches", "fx-active-top-and-prepend", "fx-active-after", "fx-property",
		]);
		expect(kinds("folderModeConflict").map((line) => line.split(":")[0])).toEqual(["fx-folder-conflict", "fx-folder-disabled-flags"]);
		expect(report.duplicateNames).toEqual([]);
		expect(report.rows.find((row) => row.id === "fx-folder-inner-child")).toMatchObject({
			path: "Folder / Inner folder / Inner template",
			migratedFrom: "Template",
			steps: 1,
		});
		expect(report.rows.find((row) => row.id === "fx-macro")?.summary).toContain("runs 'Top of note', runs 'fx-missing'");
	});

	it("lists the drops that real packages hit", () => {
		const report = buildReport({ choices: packaged.map(({ choice }) => choice) });
		const drops = report.notes
			.filter((note) => note.kind !== "inlined")
			.map((note) => `${note.kind} ${note.choiceId}: ${note.detail}`);
		expect([...new Set(drops)]).toMatchSnapshot();
	});
});
