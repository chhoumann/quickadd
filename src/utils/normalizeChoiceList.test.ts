import { describe, expect, it } from "vitest";
import { normalizeChoiceList } from "./choiceUtils";
import type IChoice from "../types/choices/IChoice";
import type IMultiChoice from "../types/choices/IMultiChoice";
import {
	folder,
	leaf,
	malformedFolder,
	malformedTree,
	malformedSnapshot,
	MALFORMED_CHILDREN_SHAPES,
} from "./malformedChoices.fixture";

const childrenOf = (choice: IChoice): IChoice[] =>
	(choice as IMultiChoice).choices ?? [];

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe("normalizeChoiceList", () => {
	it("hands back the input array itself when there is nothing to change", () => {
		// The contract that makes this safe to run on every distinct store value: a
		// healthy tree is provably untouched, so no identity churn reaches Svelte.
		const tree = [leaf("A", "a"), folder("F", "f", [leaf("B", "b")])];
		const result = normalizeChoiceList(tree);

		expect(result.choices).toBe(tree);
		expect(result.changed).toBe(false);
		expect(result.repaired).toEqual([]);
		expect((result.choices[1] as IMultiChoice).choices).toBe(
			(tree[1] as IMultiChoice).choices,
		);
	});

	it("KEEPS a whole choice whose id is a JSON number", () => {
		// #1608's exact example. It is complete, working and runnable from the
		// palette - and it was invisible in settings, then deleted by the first
		// reorder.
		const numeric = {
			id: 12,
			name: "Daily note",
			type: "Template",
			command: false,
			templatePath: "Templates/Daily.md",
		} as unknown as IChoice;

		const { choices, changed, repaired } = normalizeChoiceList([
			leaf("A", "a"),
			numeric,
			leaf("B", "b"),
		]);

		expect(changed).toBe(true);
		expect(choices).toHaveLength(3);
		const repairedChoice = choices[1] as unknown as Record<string, unknown>;
		expect(repairedChoice.name).toBe("Daily note");
		expect(repairedChoice.templatePath).toBe("Templates/Daily.md");
		expect(repairedChoice.id).toMatch(UUID);
		expect(repaired).toEqual([{ previousId: 12, choice: choices[1] }]);
	});

	it("mints a uuid rather than coercing the old id to a string", () => {
		// `String(12)` would keep `quickadd:choice:12` alive, and is wrong twice:
		// ids are compared with `===` in getChoice (so a persisted 12 -> "12" breaks
		// a ChoiceCommand{choiceId: 12} silently), and "that string is free" can
		// only mean "not seen YET" mid-walk, so it can steal a healthy later
		// sibling's id.
		const { choices } = normalizeChoiceList([
			{ id: 12, name: "Numeric", type: "Template" } as unknown as IChoice,
			leaf("Healthy", "12"),
		]);

		expect(choices[0].id).not.toBe("12");
		expect(choices[0].id).toMatch(UUID);
		// The healthy sibling keeps the id it had. A choice with a non-empty string
		// id is NEVER re-keyed on account of a malformed sibling.
		expect(choices[1].id).toBe("12");
	});

	it("keeps the healthy sibling's id whichever order they appear in", () => {
		const { choices } = normalizeChoiceList([
			leaf("Healthy", "12"),
			{ id: 12, name: "Numeric", type: "Template" } as unknown as IChoice,
		]);

		expect(choices[0].id).toBe("12");
		expect(choices[1].id).toMatch(UUID);
	});

	it("gives two id-less entries DISTINCT ids", () => {
		const { choices } = normalizeChoiceList([
			{ name: "One", type: "Template" } as IChoice,
			{ name: "Two", type: "Template" } as IChoice,
		]);

		expect(choices).toHaveLength(2);
		expect(choices[0].id).not.toBe(choices[1].id);
	});

	it("de-duplicates ids across the WHOLE tree, not just within a list", () => {
		// Choice ids are globally unique (the command registry keys on
		// `choice:<id>`), unlike command ids which only have to be unique in their
		// own list.
		const { choices } = normalizeChoiceList([
			leaf("Root", "dup"),
			folder("F", "f", [leaf("Nested", "dup")]),
		]);

		const nested = childrenOf(choices[1])[0];
		expect(choices[0].id).toBe("dup");
		expect(nested.id).toMatch(UUID);
		expect(nested.name).toBe("Nested");
	});

	it("drops a hole, which carries nothing", () => {
		const { choices, repaired } = normalizeChoiceList([
			null,
			"stray",
			7,
			leaf("Survivor", "s"),
		]);

		expect(choices).toHaveLength(1);
		expect(choices[0].name).toBe("Survivor");
		expect(repaired).toEqual([]);
	});

	it("splices an ARRAY entry in as a nested list rather than spreading it", () => {
		// `isChoiceLike([])` is true, so spreading would produce one nameless,
		// typeless row whose delete dialog says `delete 'undefined'`. The array is
		// read as a nested list - the same reading `macroCommandsValueOf` gives an
		// array-valued `macro`.
		const { choices } = normalizeChoiceList([
			leaf("A", "a"),
			[leaf("B", "b"), leaf("C", "c")],
			leaf("D", "d"),
		]);

		expect(choices.map((c) => c.name)).toEqual(["A", "B", "C", "D"]);
		expect(choices.map((c) => c.id)).toEqual(["a", "b", "c", "d"]);
	});

	it("splices junk arrays away to nothing", () => {
		const { choices } = normalizeChoiceList([[1, 2, 3], leaf("A", "a")]);
		expect(choices.map((c) => c.name)).toEqual(["A"]);
	});

	it("leaves an unreadable folder's children value exactly as found", () => {
		for (const shape of MALFORMED_CHILDREN_SHAPES.filter((s) => s.lossy)) {
			const broken = malformedFolder("Broken", "broken", shape.value);
			const { choices } = normalizeChoiceList([broken]);

			// Never replaced with the [] that childChoicesOf reads it as: the user
			// needs it on disk to recover by hand.
			expect(
				(choices[0] as unknown as Record<string, unknown>).choices,
				shape.key,
			).toEqual(shape.value);
		}
	});

	it("repairs a choice hidden inside an otherwise healthy folder", () => {
		const { choices, changed } = normalizeChoiceList([
			folder("F", "f", [{ name: "Hidden", type: "Template" } as IChoice]),
		]);

		expect(changed).toBe(true);
		const nested = childrenOf(choices[0])[0];
		expect(nested.name).toBe("Hidden");
		expect(nested.id).toMatch(UUID);
	});

	it("is idempotent: normalizing twice changes nothing the second time", () => {
		const first = normalizeChoiceList(malformedTree());
		const second = normalizeChoiceList(first.choices);

		expect(second.changed).toBe(false);
		expect(second.choices).toBe(first.choices);
	});

	it("preserves every unreadable container in the shared malformed tree", () => {
		const tree = malformedTree();
		const before = malformedSnapshot(tree);

		const { choices } = normalizeChoiceList(tree);

		expect(malformedSnapshot(choices)).toBe(before);
	});

	it("never mutates its input", () => {
		const tree = malformedTree();
		const before = JSON.stringify(tree);

		normalizeChoiceList(tree);

		expect(JSON.stringify(tree)).toBe(before);
	});

	it("reads a non-array root as empty and reports no change", () => {
		// The caller must refuse to render such a root rather than passing it in
		// (ChoiceView.rootUnreadable); this only guarantees it cannot throw.
		for (const root of [undefined, null, {}, "not a list", 7]) {
			expect(normalizeChoiceList(root)).toEqual({
				choices: [],
				changed: false,
				repaired: [],
			});
		}
	});
});
