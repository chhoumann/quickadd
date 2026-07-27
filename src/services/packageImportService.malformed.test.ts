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
