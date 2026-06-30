import { describe, expect, it } from "vitest";
import type IChoice from "src/types/choices/IChoice";
import type IMultiChoice from "src/types/choices/IMultiChoice";
import type { ChoiceType } from "src/types/choices/choiceType";
import {
	dedupeChoicesById,
	defaultIconForChoiceType,
	flattenChoices,
	flattenChoicesWithPath,
	resolveChoiceIcon,
} from "./choiceUtils";

let idCounter = 0;
function choice(name: string): IChoice {
	return {
		name,
		id: `choice-${idCounter++}`,
		type: "Template",
		command: false,
	};
}

function multi(name: string, children: IChoice[]): IMultiChoice {
	return {
		name,
		id: `multi-${idCounter++}`,
		type: "Multi",
		command: false,
		choices: children,
		collapsed: false,
	};
}

describe("flattenChoicesWithPath", () => {
	const newMeeting = choice("New meeting");
	const workLog = choice("Work log");
	const meetings = multi("Meetings", [newMeeting]);
	const work = multi("Work", [meetings, workLog]);
	const topNote = choice("Top note");
	const tree = [topNote, work];

	it("walks the tree in pre-order", () => {
		const flat = flattenChoicesWithPath(tree);

		expect(flat.map((entry) => entry.choice)).toEqual([
			topNote,
			work,
			meetings,
			newMeeting,
			workLog,
		]);
		expect(flat.map((entry) => entry.choice)).toEqual(flattenChoices(tree));
	});

	it("includes the choice's own name in its path", () => {
		const flat = flattenChoicesWithPath(tree);
		const byId = new Map(flat.map((entry) => [entry.id, entry]));

		expect(byId.get(topNote.id)?.path).toEqual(["Top note"]);
		expect(byId.get(meetings.id)?.path).toEqual(["Work", "Meetings"]);
		expect(byId.get(newMeeting.id)?.path).toEqual([
			"Work",
			"Meetings",
			"New meeting",
		]);
	});

	it("tracks depth and parent id", () => {
		const flat = flattenChoicesWithPath(tree);
		const byId = new Map(flat.map((entry) => [entry.id, entry]));

		expect(byId.get(topNote.id)).toMatchObject({ depth: 0, parentId: null });
		expect(byId.get(newMeeting.id)).toMatchObject({
			depth: 2,
			parentId: meetings.id,
		});
		expect(byId.get(workLog.id)).toMatchObject({
			depth: 1,
			parentId: work.id,
		});
	});

	it("handles a Multi with missing children array", () => {
		const broken = multi("Broken", undefined as unknown as IChoice[]);

		expect(flattenChoicesWithPath([broken])).toHaveLength(1);
	});
});

describe("dedupeChoicesById", () => {
	function withId(id: string, name = id): IChoice {
		return { name, id, type: "Template", command: false };
	}
	function multiWithId(
		id: string,
		children: IChoice[],
		name = id,
	): IMultiChoice {
		return {
			name,
			id,
			type: "Multi",
			command: false,
			choices: children,
			collapsed: false,
		};
	}

	const UUID_RE =
		/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

	it("leaves a tree with no duplicates unchanged", () => {
		const tree = [withId("a"), multiWithId("m", [withId("b"), withId("c")])];
		expect(flattenChoices(dedupeChoicesById(tree)).map((c) => c.id)).toEqual([
			"a",
			"m",
			"b",
			"c",
		]);
	});

	it("drops a byte-identical later duplicate (no data lost)", () => {
		const result = dedupeChoicesById([withId("dup"), withId("x"), withId("dup")]);
		expect(result.map((c) => c.id)).toEqual(["dup", "x"]);
	});

	it("drops a byte-identical duplicate nested inside a Multi (the #1451 signature)", () => {
		// Two byte-identical children sharing one id inside a folder - exactly what
		// blanks the settings tab via the keyed {#each}.
		const dup = (): IChoice => withId("d", "supprimer taches dones");
		const folder = multiWithId("folder", [withId("a"), dup(), dup()]);
		const deduped = dedupeChoicesById([folder])[0] as IMultiChoice;
		expect(deduped.choices.map((c) => c.id)).toEqual(["a", "d"]);
	});

	it("re-ids a DIVERGENT same-id choice instead of dropping it (no data lost)", () => {
		const result = dedupeChoicesById([
			withId("dup", "first"),
			withId("dup", "second"), // same id, different content
		]);
		expect(result).toHaveLength(2);
		expect(result[0].name).toBe("first");
		expect(result[0].id).toBe("dup");
		expect(result[1].name).toBe("second"); // kept, content intact
		expect(result[1].id).not.toBe("dup");
		expect(result[1].id).toMatch(UUID_RE);
	});

	it("re-ids a divergent duplicated Multi and PRESERVES its unique children", () => {
		// A naive drop-by-id would delete the second folder and lose child2.
		// Re-id-ing keeps both folders and all children.
		const first = multiWithId("m", [withId("child1")], "first folder");
		const second = multiWithId("m", [withId("child2")], "second folder");
		const result = dedupeChoicesById([first, second]);

		expect(result).toHaveLength(2);
		expect(result[0].id).toBe("m");
		const rebuilt = result[1] as IMultiChoice;
		expect(rebuilt.id).not.toBe("m");
		expect(rebuilt.id).toMatch(UUID_RE);
		expect(rebuilt.choices.map((c) => c.id)).toEqual(["child2"]); // not lost
	});

	it("de-dups globally across nesting levels (identical child re-using a top id -> dropped)", () => {
		const folder = dedupeChoicesById([
			withId("shared"),
			multiWithId("m", [withId("shared"), withId("ok")]),
		])[1] as IMultiChoice;
		expect(folder.choices.map((c) => c.id)).toEqual(["ok"]);
	});

	it("produces a fully unique id set when there were collisions", () => {
		const result = dedupeChoicesById([
			withId("a", "a1"),
			withId("a", "a2"), // divergent -> re-id
			multiWithId("a", [withId("a", "deep")], "folderA"), // divergent -> re-id
		]);
		const ids = flattenChoices(result).map((c) => c.id);
		expect(new Set(ids).size).toBe(ids.length); // all unique
	});

	it("does not mutate the input tree", () => {
		const folder = multiWithId("m", [withId("d"), withId("d")]);
		const input = [folder];
		dedupeChoicesById(input);

		expect(input[0]).toBe(folder);
		expect((input[0] as IMultiChoice).choices).toHaveLength(2); // original intact
	});

	it("leaves a Multi with a missing children array exactly as-is (no fabricated [])", () => {
		const broken = multiWithId("m", undefined as unknown as IChoice[]);
		const result = dedupeChoicesById([broken]);
		expect(result).toHaveLength(1);
		expect(result[0]).toBe(broken); // untouched - not rebuilt with choices: []
		expect((result[0] as IMultiChoice).choices).toBeUndefined();
	});

	it("handles an empty list", () => {
		expect(dedupeChoicesById([])).toEqual([]);
	});
});

describe("defaultIconForChoiceType", () => {
	it("maps each choice type to a meaningful lucide id", () => {
		expect(defaultIconForChoiceType("Template")).toBe("file-text");
		expect(defaultIconForChoiceType("Capture")).toBe("pencil");
		expect(defaultIconForChoiceType("Macro")).toBe("terminal");
		expect(defaultIconForChoiceType("Multi")).toBe("folder");
	});

	it("falls back to a valid icon for an unexpected runtime type", () => {
		// data.json is not runtime-validated; an imported/hand-edited choice could
		// carry a type outside the union. The default arm must never return
		// undefined, or Obsidian re-renders the question-mark glyph.
		expect(defaultIconForChoiceType("Script" as ChoiceType)).toBe("file-plus");
		expect(defaultIconForChoiceType(undefined as unknown as ChoiceType)).toBe(
			"file-plus",
		);
	});
});

describe("resolveChoiceIcon", () => {
	function choiceWith(type: ChoiceType, icon?: string): IChoice {
		return { name: "c", id: `c-${idCounter++}`, type, command: true, icon };
	}

	it("uses the per-type default when no override is set", () => {
		expect(resolveChoiceIcon(choiceWith("Template"))).toBe("file-text");
		expect(resolveChoiceIcon(choiceWith("Capture"))).toBe("pencil");
		expect(resolveChoiceIcon(choiceWith("Macro"))).toBe("terminal");
		expect(resolveChoiceIcon(choiceWith("Multi"))).toBe("folder");
	});

	it("prefers a non-empty per-choice override", () => {
		expect(resolveChoiceIcon(choiceWith("Template", "star"))).toBe("star");
		expect(resolveChoiceIcon(choiceWith("Macro", "rocket"))).toBe("rocket");
	});

	it("falls back to the default for a blank or whitespace-only override", () => {
		expect(resolveChoiceIcon(choiceWith("Template", ""))).toBe("file-text");
		expect(resolveChoiceIcon(choiceWith("Capture", "   "))).toBe("pencil");
	});

	it("trims a padded override", () => {
		expect(resolveChoiceIcon(choiceWith("Template", "  star  "))).toBe("star");
	});

	it("ignores a non-string override from malformed data without throwing", () => {
		const bad = {
			name: "c",
			id: `c-${idCounter++}`,
			type: "Template" as ChoiceType,
			command: true,
			icon: 123 as unknown as string,
		};
		expect(() => resolveChoiceIcon(bad)).not.toThrow();
		expect(resolveChoiceIcon(bad)).toBe("file-text");
	});
});
