import { describe, expect, it } from "vitest";
import type IChoice from "src/types/choices/IChoice";
import type IMultiChoice from "src/types/choices/IMultiChoice";
import { applyPackageImport } from "./packageImportService";
import { QUICKADD_PACKAGE_SCHEMA_VERSION } from "../types/packages/QuickAddPackage";
import {
	folder,
	leaf,
	malformedFolder,
	malformedSnapshot,
	malformedTree,
} from "../utils/malformedChoices.fixture";

/**
 * #1566. Package import is the one place outside the settings tab that WRITES
 * into a folder's children, and it does it from a package's declared parent id.
 * Its private writers were a second implementation of the same walkers, so they
 * needed the same two properties: never dereference a hole, and never replace an
 * unreadable value with the `[]` the rest of the app reads it as.
 */

const app = {
	vault: { adapter: { exists: async () => false, read: async () => "" } },
} as never;

const importUnder = async (existing: IChoice[], parentId: string | null) => {
	const imported = leaf("Imported", "imported-1");
	return applyPackageImport({
		app,
		existingChoices: existing,
		pkg: {
			schemaVersion: QUICKADD_PACKAGE_SCHEMA_VERSION,
			name: "Fixture",
			description: "",
			choices: [
				{ choice: imported, parentChoiceId: parentId, pathHint: ["Imported"] },
			],
			assets: [],
		} as never,
		choiceDecisions: [{ choiceId: imported.id, mode: "import" }],
		assetDecisions: [],
	});
};

const find = (tree: IChoice[], id: string): IChoice | undefined => {
	for (const c of tree) {
		if (!c || typeof c !== "object") continue;
		if (c.id === id) return c;
		const kids = (c as IMultiChoice).choices;
		if (Array.isArray(kids)) {
			const hit = find(kids, id);
			if (hit) return hit;
		}
	}
	return undefined;
};

describe("package import over a malformed tree (#1566)", () => {
	it("imports into a healthy folder without disturbing the malformed ones", async () => {
		const tree = malformedTree();
		const before = malformedSnapshot(tree);

		const result = await importUnder(tree, "healthy");

		const target = find(result.updatedChoices, "healthy") as IMultiChoice;
		expect(target.choices?.map((c) => c.id)).toContain("imported-1");
		expect(malformedSnapshot(result.updatedChoices)).toBe(before);
	});

	it("imports into a folder nested behind malformed siblings", async () => {
		const tree = malformedTree();
		const before = malformedSnapshot(tree);

		const result = await importUnder(tree, "deep");

		const target = find(result.updatedChoices, "deep") as IMultiChoice;
		expect(target.choices?.map((c) => c.id)).toContain("imported-1");
		expect(malformedSnapshot(result.updatedChoices)).toBe(before);
	});

	it("does not overwrite a folder whose contents could not be read", async () => {
		// The import still completes - the choice falls back to the root - but the
		// value the user needs in order to recover survives.
		const blob = { "0": leaf("Hidden", "hidden") };
		const tree = [
			folder("Healthy", "healthy", []),
			malformedFolder("Broken", "broken", blob),
		];

		const result = await importUnder(tree, "broken");

		const broken = find(result.updatedChoices, "broken") as IMultiChoice;
		expect(broken.choices).toEqual(blob);
		expect(find(result.updatedChoices, "imported-1")).toBeDefined();
	});

	it("repairs a folder that was carrying nothing", async () => {
		const tree = [malformedFolder("Broken", "broken", {})];

		const result = await importUnder(tree, "broken");

		const broken = find(result.updatedChoices, "broken") as IMultiChoice;
		expect(broken.choices?.map((c) => c.id)).toEqual(["imported-1"]);
	});

	it("imports at the root of a tree containing a hole", async () => {
		const tree = [null as unknown as IChoice, leaf("Leaf", "leaf")];

		const result = await importUnder(tree, null);

		expect(find(result.updatedChoices, "imported-1")).toBeDefined();
	});
});

/**
 * #1593. The importer's macro writers dereferenced `macro` / `macro.commands`
 * raw, and a PACKAGED folder's children list was dereferenced raw too. The
 * second one only became reachable when this change guarded the preview walker:
 * before that the package died at preview, so the Import button never lit.
 */
const importPackaged = async (
	choices: IChoice[],
	mode: "import" | "duplicate" = "import",
	existing: IChoice[] = [],
) =>
	applyPackageImport({
		app,
		existingChoices: existing,
		pkg: {
			schemaVersion: QUICKADD_PACKAGE_SCHEMA_VERSION,
			name: "Fixture",
			description: "",
			choices: choices.map((choice) => ({
				choice,
				parentChoiceId: null,
				pathHint: [choice.name],
			})),
			assets: [],
		} as never,
		choiceDecisions: choices.map((c) => ({ choiceId: c.id, mode })),
		assetDecisions: [],
	});

const macroChoice = (id: string, macro: unknown): IChoice =>
	({
		id,
		name: `Macro ${id}`,
		type: "Macro",
		command: false,
		runOnStartup: false,
		macro,
	}) as unknown as IChoice;

const choiceCommand = (id: string, choiceId: string) => ({
	id,
	name: "Run choice",
	type: "Choice",
	choiceId,
});

describe("package import over a malformed macro (#1593)", () => {
	it.each([
		["null", null],
		["a string", "not a macro"],
		["an array-turned-object", { "0": {} }],
		["commands as a string", { id: "m", name: "M", commands: "not a list" }],
		["commands with a hole", { id: "m", name: "M", commands: [null] }],
	])("imports a macro whose macro value is %s without throwing", async (_l, macro) => {
		const result = await importPackaged([macroChoice("m1", macro)]);
		expect(find(result.updatedChoices, "m1")).toBeDefined();
	});

	it.each([
		["null", null],
		["a string", "not a macro"],
	])("leaves a %s macro value exactly as it found it", async (_l, macro) => {
		const result = await importPackaged([macroChoice("m1", macro)]);
		const imported = find(result.updatedChoices, "m1") as unknown as {
			macro: unknown;
		};
		expect(imported.macro).toEqual(macro);
	});

	// An array-valued `macro` IS the command list (MacroBuilder's recovery path),
	// so its entries have to be remapped like any other - otherwise a duplicated
	// choice keeps the ORIGINAL id and invokes the pre-existing local choice
	// instead of the imported copy.
	it("remaps choice references inside an array-valued macro", async () => {
		const target = leaf("Target", "target-1");
		const macro = macroChoice("m1", [choiceCommand("cmd-1", "target-1")]);

		const result = await importPackaged([target, macro], "duplicate", [
			leaf("Target", "target-1"),
		]);

		const imported = result.updatedChoices.find(
			(c) => c.type === "Macro",
		) as unknown as { macro: { choiceId: string }[] };
		const importedTarget = result.updatedChoices.find(
			(c) => c.type === "Template" && c.id !== "target-1",
		);

		expect(importedTarget).toBeDefined();
		// The reference follows the duplicate, not the pre-existing local choice.
		expect(imported.macro[0].choiceId).toBe(importedTarget?.id);
		expect(imported.macro[0].choiceId).not.toBe("target-1");
	});

	it("does not silently no-op the macro id when duplicating an array-valued macro", async () => {
		const macro = macroChoice("m1", [choiceCommand("cmd-1", "nope")]);
		const result = await importPackaged([macro], "duplicate", [
			macroChoice("m1", [choiceCommand("cmd-1", "nope")]),
		]);

		// The array survives the JSON round-trip whole; nothing was written onto it
		// as a non-index property (which JSON.stringify would have dropped).
		const persisted = JSON.parse(JSON.stringify(result.updatedChoices));
		const imported = persisted.filter(
			(c: IChoice) => c.type === "Macro",
		) as unknown as { macro: unknown[] }[];
		expect(imported).toHaveLength(2);
		for (const m of imported) {
			expect(Array.isArray(m.macro)).toBe(true);
			expect(m.macro).toHaveLength(1);
		}
	});

	// Before this change the deref here threw and aborted the WHOLE import, and
	// guarding the preview walker is what made it reachable: the package used to
	// die at preview, so the Import button never lit.
	it("imports a packaged folder whose children list holds a hole", async () => {
		const kid = leaf("Kid", "kid-1");
		const packagedFolder = {
			id: "f1",
			name: "Packaged folder",
			type: "Multi",
			command: false,
			collapsed: false,
			choices: [null, kid],
		} as unknown as IChoice;

		const result = await applyPackageImport({
			app,
			existingChoices: [],
			pkg: {
				schemaVersion: QUICKADD_PACKAGE_SCHEMA_VERSION,
				name: "Fixture",
				description: "",
				choices: [
					{ choice: packagedFolder, parentChoiceId: null, pathHint: ["F"] },
					{ choice: kid, parentChoiceId: "f1", pathHint: ["F", "Kid"] },
				],
				assets: [],
			} as never,
			choiceDecisions: [
				{ choiceId: "f1", mode: "import" },
				{ choiceId: "kid-1", mode: "import" },
			],
			assetDecisions: [],
		});

		const imported = find(result.updatedChoices, "f1") as IMultiChoice;
		expect(imported).toBeDefined();
		// The hole carried nothing and is gone; the real child survived, and the
		// import completed rather than aborting on the deref.
		expect(imported.choices?.map((c) => c.id)).toEqual(["kid-1"]);
	});
});
