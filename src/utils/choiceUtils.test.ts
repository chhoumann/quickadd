import { describe, expect, it } from "vitest";
import type IChoice from "src/types/choices/IChoice";
import type IMultiChoice from "src/types/choices/IMultiChoice";
import { flattenChoices, flattenChoicesWithPath } from "./choiceUtils";

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
