import { describe, expect, it, vi } from "vitest";

// choiceService transitively imports the ChoiceBuilders -> formatter/engine graph
// -> obsidian-dataview's CJS require('obsidian'); mock it like the component suite.
vi.mock("obsidian-dataview", () => ({ getAPI: vi.fn() }));

import { addChoiceToTree, insertIntoMulti } from "./choiceService";
import type IChoice from "../types/choices/IChoice";
import type IMultiChoice from "../types/choices/IMultiChoice";

const leaf = (id: string, name: string): IChoice =>
	({ id, name, type: "Template" }) as unknown as IChoice;

const folder = (id: string, name: string, children: IChoice[]): IMultiChoice =>
	({
		id,
		name,
		type: "Multi",
		collapsed: false,
		choices: children,
	}) as unknown as IMultiChoice;

describe("insertIntoMulti", () => {
	it("appends a child to a root-level folder, immutably", () => {
		const roots: IChoice[] = [
			folder("f1", "F1", [leaf("a", "A")]),
			leaf("b", "B"),
		];

		const result = insertIntoMulti(roots, "f1", leaf("c", "C"));

		expect(result).toBeDefined();
		expect((result?.[0] as IMultiChoice).choices.map((c) => c.id)).toEqual([
			"a",
			"c",
		]);
		// Untouched sibling is referentially preserved.
		expect(result?.[1]).toBe(roots[1]);
		// Original tree is not mutated.
		expect((roots[0] as IMultiChoice).choices.map((c) => c.id)).toEqual([
			"a",
		]);
	});

	it("appends into a nested folder at depth >= 2", () => {
		const roots: IChoice[] = [folder("f1", "F1", [folder("f2", "F2", [])])];

		const result = insertIntoMulti(roots, "f2", leaf("c", "C"));

		expect(result).toBeDefined();
		const f2 = (result?.[0] as IMultiChoice).choices[0] as IMultiChoice;
		expect(f2.choices.map((c) => c.id)).toEqual(["c"]);
		// Original nested folder still empty.
		expect(
			((roots[0] as IMultiChoice).choices[0] as IMultiChoice).choices,
		).toHaveLength(0);
	});

	it("returns undefined when the target folder does not exist", () => {
		const roots: IChoice[] = [folder("f1", "F1", []), leaf("b", "B")];
		expect(
			insertIntoMulti(roots, "does-not-exist", leaf("c", "C")),
		).toBeUndefined();
	});
});

describe("addChoiceToTree", () => {
	it("appends at root when no targetFolderId is given (immutably)", () => {
		const roots: IChoice[] = [leaf("a", "A")];
		const res = addChoiceToTree(roots, leaf("b", "B"));
		expect(res.map((c) => c.id)).toEqual(["a", "b"]);
		expect(roots).toHaveLength(1); // original untouched
	});

	it("inserts into a folder and expands it", () => {
		const roots: IChoice[] = [folder("f1", "F1", [leaf("a", "A")])];
		(roots[0] as IMultiChoice).collapsed = true;

		const res = addChoiceToTree(roots, leaf("c", "C"), "f1");
		const f1 = res[0] as IMultiChoice;
		expect(f1.choices.map((c) => c.id)).toEqual(["a", "c"]);
		expect(f1.collapsed).toBe(false);
	});

	it("inserts into a nested folder (depth >= 2) and expands it", () => {
		const roots: IChoice[] = [folder("f1", "F1", [folder("f2", "F2", [])])];
		((roots[0] as IMultiChoice).choices[0] as IMultiChoice).collapsed = true;

		const res = addChoiceToTree(roots, leaf("c", "C"), "f2");
		const f2 = (res[0] as IMultiChoice).choices[0] as IMultiChoice;
		expect(f2.choices.map((c) => c.id)).toEqual(["c"]);
		expect(f2.collapsed).toBe(false);
	});

	it("falls back to a root append when the target folder is missing", () => {
		const roots: IChoice[] = [folder("f1", "F1", [])];
		const res = addChoiceToTree(roots, leaf("c", "C"), "nope");
		expect(res.map((c) => c.id)).toEqual(["f1", "c"]);
	});
});
