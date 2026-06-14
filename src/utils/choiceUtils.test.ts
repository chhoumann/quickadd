import { describe, expect, it } from "vitest";
import type IChoice from "src/types/choices/IChoice";
import type IMultiChoice from "src/types/choices/IMultiChoice";
import type { ChoiceType } from "src/types/choices/choiceType";
import {
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

// Documents the selection contract QuickAdd.registerShareMenu (#632) relies on:
// flatten the (possibly nested) tree, keep only choices flagged showInShareMenu,
// and title each item by its name path so duplicates in different folders stay
// distinguishable in Obsidian's mobile share menu.
describe("share-menu selection (flattenChoicesWithPath + showInShareMenu)", () => {
	const selectForShareMenu = (choices: IChoice[]) =>
		flattenChoicesWithPath(choices)
			.filter((entry) => entry.choice.showInShareMenu)
			.map((entry) => entry.path.join(" / "));

	it("selects only flagged choices, including deeply nested ones", () => {
		const shared = choice("Shared note");
		shared.showInShareMenu = true;
		const unshared = choice("Plain note");
		const nestedShared = choice("Nested macro");
		nestedShared.showInShareMenu = true;
		const folder = multi("Inbox", [nestedShared, unshared]);

		const titles = selectForShareMenu([shared, unshared, folder]);

		expect(titles).toEqual(["Shared note", "Inbox / Nested macro"]);
	});

	it("disambiguates same-named choices in different folders by path", () => {
		const a = choice("Inbox");
		a.showInShareMenu = true;
		const b = choice("Inbox");
		b.showInShareMenu = true;
		const work = multi("Work", [a]);
		const personal = multi("Personal", [b]);

		const titles = selectForShareMenu([work, personal]);

		expect(titles).toEqual(["Work / Inbox", "Personal / Inbox"]);
	});

	it("returns nothing when no choice opts in", () => {
		expect(selectForShareMenu([choice("a"), multi("F", [choice("b")])])).toEqual(
			[],
		);
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
