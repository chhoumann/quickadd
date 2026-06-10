import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "obsidian";

vi.mock("obsidian-dataview", () => ({
	getAPI: vi.fn(),
}));

import type QuickAdd from "../../main";
import type IChoice from "../../types/choices/IChoice";
import type IMultiChoice from "../../types/choices/IMultiChoice";
import type { IChoiceExecutor } from "../../IChoiceExecutor";
import { MultiChoice } from "../../types/choices/MultiChoice";
import { settingsStore } from "../../settingsStore";
import ChoiceSuggester, {
	BACK_CHOICE_ID,
	stripInlineMarkdown,
} from "./choiceSuggester";

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

function makeBack(wrapping: IChoice[]): IMultiChoice {
	const back = new MultiChoice("← Back").addChoices(wrapping);
	back.id = BACK_CHOICE_ID;
	return back;
}

describe("ChoiceSuggester", () => {
	let app: App;
	let plugin: QuickAdd;
	let executor: IChoiceExecutor;
	let executed: IChoice[];

	// Fixture tree:
	//   Top note
	//   Work (Multi)
	//     Meetings (Multi)
	//       New meeting
	//     Work log
	//   Footnotes
	let topNote: IChoice;
	let newMeeting: IChoice;
	let workLog: IChoice;
	let meetings: IMultiChoice;
	let work: IMultiChoice;
	let footnotes: IChoice;
	let rootChoices: IChoice[];

	beforeAll(() => {
		// Obsidian's DOM extensions, used by renderSuggestion, are absent in jsdom.
		const proto = HTMLElement.prototype as unknown as Record<string, unknown>;
		proto.empty ??= function (this: HTMLElement) {
			this.replaceChildren();
		};
		proto.createDiv ??= function (
			this: HTMLElement,
			opts?: string | { cls?: string; text?: string }
		) {
			const div = document.createElement("div");
			if (typeof opts === "string") div.className = opts;
			else if (opts?.cls) div.className = opts.cls;
			if (typeof opts === "object" && opts?.text) div.textContent = opts.text;
			this.appendChild(div);
			return div;
		};
	});

	beforeEach(() => {
		app = new App();
		plugin = { app } as unknown as QuickAdd;
		executed = [];
		executor = {
			execute: (c: IChoice) => {
				executed.push(c);
				return Promise.resolve();
			},
			variables: new Map(),
		} as unknown as IChoiceExecutor;

		topNote = choice("Top note");
		newMeeting = choice("New meeting");
		workLog = choice("Work log");
		meetings = multi("Meetings", [newMeeting]);
		work = multi("Work", [meetings, workLog]);
		footnotes = choice("Footnotes");
		rootChoices = [topNote, work, footnotes];

		settingsStore.setState({ searchNestedChoices: true });
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	function makeSuggester(choices: IChoice[]): ChoiceSuggester {
		return new ChoiceSuggester(plugin, choices, { choiceExecutor: executor });
	}

	describe("getSuggestions", () => {
		it("shows only the current level for an empty query", () => {
			const suggester = makeSuggester(rootChoices);

			const items = suggester.getSuggestions("").map((s) => s.item);

			expect(items).toEqual(rootChoices);
		});

		it("treats a whitespace-only query as empty", () => {
			const suggester = makeSuggester(rootChoices);

			const items = suggester.getSuggestions("   ").map((s) => s.item);

			expect(items).toEqual(rootChoices);
		});

		it("searches only the current level when the setting is disabled", () => {
			settingsStore.setState({ searchNestedChoices: false });
			const suggester = makeSuggester(rootChoices);

			const items = suggester.getSuggestions("meeting").map((s) => s.item);

			expect(items).not.toContain(newMeeting);
			expect(items).not.toContain(meetings);
			// Positive control: the level-scoped fallback still matches.
			expect(suggester.getSuggestions("work").map((s) => s.item)).toEqual([
				work,
			]);
		});

		it("surfaces nested choices by identity when the setting is enabled", () => {
			const suggester = makeSuggester(rootChoices);

			const items = suggester.getSuggestions("meeting").map((s) => s.item);

			expect(items).toContain(newMeeting);
			expect(items).toContain(meetings);
		});

		it("matches against the full breadcrumb path text", () => {
			const suggester = makeSuggester(rootChoices);

			const items = suggester
				.getSuggestions("work / mee")
				.map((s) => s.item);

			expect(items).toContain(meetings);
			expect(items).toContain(newMeeting);
			expect(items).not.toContain(workLog);
		});

		it("penalizes matches confined to the breadcrumb prefix", () => {
			const suggester = makeSuggester(rootChoices);

			const results = suggester.getSuggestions("work");
			const scoreOf = (c: IChoice) =>
				results.find((s) => s.item === c)?.match.score;

			// The stub scores every match 0, so any delta is the penalty.
			expect(scoreOf(work)).toBe(0);
			expect(scoreOf(meetings)).toBeLessThan(0);
			expect(scoreOf(newMeeting)).toBeLessThan(0);
		});

		it("does not penalize matches that touch the choice's own name", () => {
			const suggester = makeSuggester(rootChoices);

			const results = suggester.getSuggestions("meetings");
			const scoreOf = (c: IChoice) =>
				results.find((s) => s.item === c)?.match.score;

			// "Meetings" matches its own name segment of "Work / Meetings".
			expect(scoreOf(meetings)).toBe(0);
			// "...New meeting"'s match falls entirely within "Work / Meetings /".
			expect(scoreOf(newMeeting)).toBeLessThan(0);
		});

		it("ranks name matches above breadcrumb-only descendant matches", () => {
			// "Networking" flattens AFTER Work's subtree; without the penalty,
			// stable sorting by flatten order would bury it below them.
			const networking = choice("Networking");
			const suggester = makeSuggester([...rootChoices, networking]);

			const items = suggester.getSuggestions("work").map((s) => s.item);

			expect(items[0]).toBe(work);
			expect(items.indexOf(networking)).toBeLessThan(
				items.indexOf(meetings)
			);
			expect(items).toEqual(
				expect.arrayContaining([meetings, newMeeting, workLog])
			);
		});

		it("never traverses into the back item or returns it for typed queries", () => {
			const drilledLevel = [...work.choices, makeBack(rootChoices)];
			const suggester = makeSuggester(drilledLevel);

			expect(
				suggester.getSuggestions("top").map((s) => s.item)
			).not.toContain(topNote);
			expect(
				suggester.getSuggestions("back").map((s) => s.item.id)
			).not.toContain(BACK_CHOICE_ID);
		});

		it("keeps the back item in the empty-query view", () => {
			const drilledLevel = [...work.choices, makeBack(rootChoices)];
			const suggester = makeSuggester(drilledLevel);

			const ids = suggester.getSuggestions("").map((s) => s.item.id);

			expect(ids).toContain(BACK_CHOICE_ID);
		});

		it("excludes ancestor back items after navigating back from depth 2", () => {
			// Drill root -> Work -> Meetings, then press Back: the restored level
			// is back_meetings.choices, which still contains back_work. The
			// sentinel id must catch that ancestor back item statelessly.
			const workLevel = [...work.choices, makeBack(rootChoices)];
			const meetingsLevel = [...meetings.choices, makeBack(workLevel)];
			const backToWork = meetingsLevel[meetingsLevel.length - 1] as IMultiChoice;

			const restored = makeSuggester([...backToWork.choices]);
			const items = restored.getSuggestions("o").map((s) => s.item);

			expect(items).toContain(workLog);
			expect(items).not.toContain(topNote);
			expect(items).not.toContain(footnotes);
			expect(items.map((i) => i.id)).not.toContain(BACK_CHOICE_ID);
		});
	});

	describe("onChooseItem", () => {
		it("executes nested leaves through the injected executor", () => {
			const suggester = makeSuggester(rootChoices);

			suggester.onChooseItem(newMeeting, new MouseEvent("click"));

			expect(executed).toEqual([newMeeting]);
		});

		it("appends a sentinel back item when drilling into a Multi", () => {
			const openSpy = vi
				.spyOn(ChoiceSuggester, "Open")
				.mockImplementation(() => {});
			const suggester = makeSuggester(rootChoices);

			suggester.onChooseItem(work, new MouseEvent("click"));

			const [, passedChoices, options] = openSpy.mock.calls[0] as unknown as [
				QuickAdd,
				IChoice[],
				{
					choiceExecutor?: IChoiceExecutor;
					placeholder?: string;
					placeholderStack?: Array<string | undefined>;
				},
			];
			const back = passedChoices.find((c) => c.id === BACK_CHOICE_ID);
			expect(back).toBeDefined();
			expect((back as IMultiChoice).choices).toEqual(rootChoices);
			expect(passedChoices.slice(0, -1)).toEqual(work.choices);
			// The same executor is threaded through, so variables survive
			// drill-down, and the placeholder stack records the origin level.
			expect(options.choiceExecutor).toBe(executor);
			expect(options.placeholder).toBe("Work");
			expect(options.placeholderStack).toEqual([undefined]);
		});

		it("navigates back without appending another back item", () => {
			const openSpy = vi
				.spyOn(ChoiceSuggester, "Open")
				.mockImplementation(() => {});
			const drilledLevel = [...work.choices, makeBack(rootChoices)];
			const suggester = makeSuggester(drilledLevel);

			suggester.onChooseItem(
				drilledLevel[drilledLevel.length - 1],
				new MouseEvent("click")
			);

			const [, passedChoices] = openSpy.mock.calls[0] as unknown as [
				QuickAdd,
				IChoice[],
			];
			expect(passedChoices).toEqual(rootChoices);
		});

		it("treats a user Multi literally named '← Back' as a normal Multi", () => {
			const openSpy = vi
				.spyOn(ChoiceSuggester, "Open")
				.mockImplementation(() => {});
			const impostor = multi("← Back", [choice("Inside impostor")]);
			const suggester = makeSuggester([impostor]);

			suggester.onChooseItem(impostor, new MouseEvent("click"));

			const [, passedChoices] = openSpy.mock.calls[0] as unknown as [
				QuickAdd,
				IChoice[],
			];
			// A real back item is appended, so the user is not stranded.
			expect(passedChoices.some((c) => c.id === BACK_CHOICE_ID)).toBe(true);
		});
	});

	describe("renderSuggestion", () => {
		async function render(
			suggester: ChoiceSuggester,
			item: IChoice
		): Promise<HTMLElement> {
			const el = document.createElement("div");
			suggester.renderSuggestion(
				{ item, match: { score: 0, matches: [] } },
				el
			);
			await Promise.resolve();
			return el;
		}

		it("renders breadcrumbs that disambiguate duplicate names", async () => {
			const taskA = choice("New task");
			const taskB = choice("New task");
			const clientA = multi("Client A", [taskA]);
			const clientB = multi("Client B", [taskB]);
			const suggester = makeSuggester([clientA, clientB]);
			suggester.getSuggestions("new task");

			const elA = await render(suggester, taskA);
			const elB = await render(suggester, taskB);

			expect(elA.querySelector(".suggestion-note")?.textContent).toBe(
				"Client A"
			);
			expect(elB.querySelector(".suggestion-note")?.textContent).toBe(
				"Client B"
			);
			expect(elA.querySelector(".suggestion-title")?.textContent).toBe(
				"New task"
			);
			expect(elA.classList.contains("mod-complex")).toBe(true);
		});

		it("strips inline markdown from breadcrumb segments", async () => {
			const inner = choice("Inner");
			const styled = multi("**Bold** folder", [inner]);
			const suggester = makeSuggester([styled]);
			suggester.getSuggestions("inner");

			const el = await render(suggester, inner);

			expect(el.querySelector(".suggestion-note")?.textContent).toBe(
				"Bold folder"
			);
		});

		it("renders current-level items without breadcrumbs", async () => {
			const suggester = makeSuggester(rootChoices);
			suggester.getSuggestions("top");

			const el = await render(suggester, topNote);

			expect(el.querySelector(".suggestion-note")).toBeNull();
			expect(el.textContent).toBe("Top note");
		});

		it("styles the sentinel back item but not a Multi named '← Back'", async () => {
			const impostor = multi("← Back", []);
			const back = makeBack(rootChoices);
			const suggester = makeSuggester([impostor, back]);
			suggester.getSuggestions("anything");

			const backEl = await render(suggester, back);
			const impostorEl = await render(suggester, impostor);

			expect(
				backEl.classList.contains("quickadd-choice-suggestion-back")
			).toBe(true);
			expect(backEl.querySelector(".suggestion-note")).toBeNull();
			expect(
				impostorEl.classList.contains("quickadd-choice-suggestion-back")
			).toBe(false);
		});
	});
});

describe("stripInlineMarkdown", () => {
	it.each([
		["**bold**", "bold"],
		["__bold__", "bold"],
		["*italic*", "italic"],
		["my_file_name", "my_file_name"],
		["`code`", "code"],
		["~~gone~~", "gone"],
		["[label](https://example.com)", "label"],
		["[[Note]]", "Note"],
		["[[Note|alias]]", "alias"],
		["plain name", "plain name"],
		["**Work** / not nested", "Work / not nested"],
	])("reduces %s to %s", (input, expected) => {
		expect(stripInlineMarkdown(input)).toBe(expected);
	});
});
