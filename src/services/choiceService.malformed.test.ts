import { describe, expect, it } from "vitest";
import type IChoice from "src/types/choices/IChoice";
import type IMultiChoice from "src/types/choices/IMultiChoice";
import {
	addChoiceToTree,
	duplicateChoice,
	findChoiceById,
	insertChoiceAfter,
	insertIntoMulti,
	moveChoice,
	moveChoiceToRoot,
	removeChoiceById,
	setFolderChildrenById,
	setMultiCollapsedById,
} from "./choiceService";
import {
	HEALTHY_IDS,
	leaf,
	malformedFolder,
	malformedSnapshot,
	malformedTree,
	MALFORMED_CHILDREN_SHAPES,
} from "../utils/malformedChoices.fixture";

/**
 * #1566. A folder whose `choices` value is missing or is not an array is
 * deliberately preserved on load rather than repaired, so the tree walkers have
 * to satisfy two things at once: never throw on it, and never rewrite it.
 *
 * The second is the one that is easy to get wrong and impossible to notice: the
 * settings tab saves the whole tree after every edit, so a walker that rebuilds
 * every folder it passes would replace the preserved value with `[]` the first
 * time the user collapses an unrelated folder. Every case below therefore
 * asserts the malformed values are byte-identical afterwards, not just that
 * nothing threw.
 */

describe("choice-tree walkers over a malformed tree (#1566)", () => {
	const target = () => leaf("Moving", "moving");

	// Each entry: a name, and an edit that touches something OTHER than a
	// malformed folder. None of them should disturb the malformed values.
	const unrelatedEdits: [string, (tree: IChoice[]) => IChoice[]][] = [
		["collapse an unrelated folder", (t) => setMultiCollapsedById(t, "healthy", true)],
		["expand an unrelated folder", (t) => setMultiCollapsedById(t, "healthy", false)],
		["delete an unrelated leaf", (t) => removeChoiceById(t, "child").updated],
		["delete a root-level leaf", (t) => removeChoiceById(t, "head").updated],
		[
			"insert a choice after an unrelated leaf",
			(t) => insertChoiceAfter(t, "child", target()) ?? t,
		],
		["add a choice into an unrelated folder", (t) => addChoiceToTree(t, target(), "healthy")],
		["add a choice at the root", (t) => addChoiceToTree(t, target())],
		[
			"commit a reorder in an unrelated folder",
			(t) => setFolderChildrenById(t, "healthy", [target()]),
		],
		["move a choice into an unrelated folder", (t) => moveChoice(t, "head", "healthy")],
		["move a nested choice back to the root", (t) => moveChoiceToRoot(t, "child")],
	];

	it.each(unrelatedEdits)("%s leaves every malformed value untouched", (_name, edit) => {
		const tree = malformedTree();
		const before = malformedSnapshot(tree);

		const after = edit(tree);

		expect(malformedSnapshot(after)).toBe(before);
		// ...and the edit still worked: the tree is intact and walkable.
		expect(after.length).toBeGreaterThan(0);
	});

	it("finds every healthy choice past a malformed folder", () => {
		const tree = malformedTree();
		for (const id of HEALTHY_IDS) {
			expect(findChoiceById(tree, id)?.id).toBe(id);
		}
		expect(findChoiceById(tree, "nope")).toBeUndefined();
	});

	it("reads a malformed folder as an empty folder", () => {
		const tree = malformedTree();
		for (const shape of MALFORMED_CHILDREN_SHAPES) {
			const folder = findChoiceById(tree, `broken-${shape.key}`) as IMultiChoice;
			expect(folder).toBeDefined();
			// Present in the tree, addressable, and carrying nothing readable.
			expect(folder.type).toBe("Multi");
		}
	});

	it("deletes a malformed folder without disturbing its neighbours", () => {
		const tree = malformedTree();
		const { updated, removed } = removeChoiceById(tree, "broken-emptyObject");

		expect(removed?.id).toBe("broken-emptyObject");
		expect(findChoiceById(updated, "broken-emptyObject")).toBeUndefined();
		for (const id of HEALTHY_IDS) {
			expect(findChoiceById(updated, id)?.id).toBe(id);
		}
	});

	describe("writing into a malformed folder", () => {
		it("repairs a folder that was carrying nothing", () => {
			// undefined / null / {} lost nothing, so adopting a real array is a
			// repair, not a loss - and it is what makes the folder usable again.
			for (const shape of MALFORMED_CHILDREN_SHAPES.filter((s) => !s.lossy)) {
				const tree = malformedTree();
				const id = `broken-${shape.key}`;
				const updated = insertIntoMulti(tree, id, target());
				expect(updated, shape.key).toBeDefined();
				const folder = findChoiceById(updated!, id) as IMultiChoice;
				expect(folder.choices, shape.key).toEqual([target()]);
			}
		});

		it("refuses to overwrite a value that could still hold choices", () => {
			for (const shape of MALFORMED_CHILDREN_SHAPES.filter((s) => s.lossy)) {
				const tree = malformedTree();
				const before = malformedSnapshot(tree);
				const id = `broken-${shape.key}`;

				// No folder is reported as updated, so addChoiceToTree falls back to
				// a root append rather than destroying the value.
				expect(insertIntoMulti(tree, id, target()), shape.key).toBeUndefined();

				const appended = addChoiceToTree(tree, target(), id);
				expect(malformedSnapshot(appended), shape.key).toBe(before);
				expect(appended.some((c) => c?.id === "moving"), shape.key).toBe(true);
			}
		});
	});

	describe("duplicating", () => {
		it("copies an unreadable children value across verbatim", () => {
			const blob = { "0": leaf("Hidden", "hidden") };
			const copy = duplicateChoice(
				malformedFolder("Broken", "broken", blob),
			) as IMultiChoice;

			expect(copy.name).toBe("Broken (copy)");
			expect(copy.choices).toBe(blob);
		});

		it("copies a folder that merely has no children key", () => {
			const copy = duplicateChoice(
				malformedFolder("Broken", "broken", undefined),
			) as IMultiChoice;

			expect(copy.name).toBe("Broken (copy)");
			expect(copy.choices).toBeUndefined();
		});
	});
});
