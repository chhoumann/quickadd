import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { App, Notice } from "obsidian";

vi.mock("obsidian-dataview", () => ({
	getAPI: vi.fn(),
}));

// Spy on the engine entry while keeping hasConfiguredTemplateFolders real (the
// constructor's injection gate depends on it).
vi.mock("../../engine/runTemplateFromFolder", async (importOriginal) => {
	const actual =
		await importOriginal<typeof RunTemplateFromFolderModule>();
	return { ...actual, runTemplateFromFolder: vi.fn().mockResolvedValue(undefined) };
});

vi.mock("../../utils/frontmatterPropertyLinks", async (importOriginal) => {
	const actual =
		await importOriginal<Record<string, unknown>>();
	return { ...actual, getFocusedPropertyTarget: vi.fn(() => null) };
});

import type QuickAdd from "../../main";
import type IChoice from "../../types/choices/IChoice";
import type IMultiChoice from "../../types/choices/IMultiChoice";
import type { IChoiceExecutor } from "../../IChoiceExecutor";
import {
	getFocusedPropertyTarget,
	type FrontmatterPropertyTarget,
} from "../../utils/frontmatterPropertyLinks";
import { MultiChoice } from "../../types/choices/MultiChoice";
import { UserCancelError } from "../../errors/UserCancelError";
import { settingsStore } from "../../settingsStore";
import { runTemplateFromFolder } from "../../engine/runTemplateFromFolder";
import type * as RunTemplateFromFolderModule from "../../engine/runTemplateFromFolder";
import ChoiceSuggester, {
	BACK_CHOICE_ID,
	emptyFolderNoticeText,
	RUN_TEMPLATE_FROM_FOLDER_ID,
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
		vi.mocked(getFocusedPropertyTarget).mockReturnValue(null);
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	function makeSuggester(
		choices: IChoice[],
		options: { focusedProperty?: FrontmatterPropertyTarget | null } = {},
	): ChoiceSuggester {
		return new ChoiceSuggester(plugin, choices, {
			choiceExecutor: executor,
			...options,
		});
	}

	describe("template folder launcher row", () => {
		function pluginWith(settings: {
			templateFolderPaths?: string[];
			templateFolderLauncherRow?: "off" | "top" | "bottom" | undefined;
		}): QuickAdd {
			return {
				app,
				settings: {
					templateFolderPaths: settings.templateFolderPaths ?? [],
					// Mirror DEFAULT_SETTINGS: undefined means "bottom".
					templateFolderLauncherRow:
						"templateFolderLauncherRow" in settings
							? settings.templateFolderLauncherRow
							: "bottom",
				},
			} as unknown as QuickAdd;
		}

		function open(p: QuickAdd, includeRow: boolean): ChoiceSuggester {
			return new ChoiceSuggester(p, rootChoices, {
				choiceExecutor: executor,
				includeTemplateFolderRow: includeRow,
			});
		}

		it("appends the row at the bottom by default (keeps the first choice first)", () => {
			const s = open(pluginWith({ templateFolderPaths: ["Templates"] }), true);
			const ids = s.getSuggestions("").map((x) => x.item.id);
			expect(ids[0]).toBe(rootChoices[0].id);
			expect(ids[ids.length - 1]).toBe(RUN_TEMPLATE_FROM_FOLDER_ID);
			expect(ids.slice(0, -1)).toEqual(rootChoices.map((c) => c.id));
		});

		it("prepends the row when position is 'top'", () => {
			const s = open(
				pluginWith({
					templateFolderPaths: ["Templates"],
					templateFolderLauncherRow: "top",
				}),
				true,
			);
			const ids = s.getSuggestions("").map((x) => x.item.id);
			expect(ids[0]).toBe(RUN_TEMPLATE_FROM_FOLDER_ID);
			expect(ids.slice(1)).toEqual(rootChoices.map((c) => c.id));
		});

		it("falls back to bottom when the position is unset (legacy data.json)", () => {
			const s = open(
				pluginWith({
					templateFolderPaths: ["Templates"],
					templateFolderLauncherRow: undefined,
				}),
				true,
			);
			const ids = s.getSuggestions("").map((x) => x.item.id);
			expect(ids[ids.length - 1]).toBe(RUN_TEMPLATE_FROM_FOLDER_ID);
		});

		it("omits the row when position is 'off'", () => {
			const s = open(
				pluginWith({
					templateFolderPaths: ["Templates"],
					templateFolderLauncherRow: "off",
				}),
				true,
			);
			expect(
				s.getSuggestions("").map((x) => x.item.id),
			).not.toContain(RUN_TEMPLATE_FROM_FOLDER_ID);
		});

		it("omits the row when no template folder is configured (any position)", () => {
			for (const pos of ["top", "bottom"] as const) {
				const s = open(
					pluginWith({ templateFolderPaths: [], templateFolderLauncherRow: pos }),
					true,
				);
				expect(
					s.getSuggestions("").map((x) => x.item.id),
				).not.toContain(RUN_TEMPLATE_FROM_FOLDER_ID);
			}
		});

		it("never injects the row for nested levels (includeTemplateFolderRow unset)", () => {
			const s = new ChoiceSuggester(
				pluginWith({ templateFolderPaths: ["Templates"] }),
				rootChoices,
				{ choiceExecutor: executor },
			);
			expect(
				s.getSuggestions("").map((x) => x.item.id),
			).not.toContain(RUN_TEMPLATE_FROM_FOLDER_ID);
		});

		it("excludes the row from nested search results (top or bottom)", () => {
			for (const pos of ["top", "bottom"] as const) {
				const s = open(
					pluginWith({
						templateFolderPaths: ["Templates"],
						templateFolderLauncherRow: pos,
					}),
					true,
				);
				// Typed query goes through the nested-candidate path, which drops the row.
				expect(
					s.getSuggestions("template").map((x) => x.item.id),
				).not.toContain(RUN_TEMPLATE_FROM_FOLDER_ID);
			}
		});

		it("dispatches the sentinel row to runTemplateFromFolder, not the executor", () => {
			const p = pluginWith({ templateFolderPaths: ["Templates"] });
			const s = open(p, true);
			const row = s
				.getSuggestions("")
				.map((x) => x.item)
				.find((c) => c.id === RUN_TEMPLATE_FROM_FOLDER_ID)!;

			s.onChooseItem(row, new MouseEvent("click"));

			expect(vi.mocked(runTemplateFromFolder)).toHaveBeenCalledTimes(1);
			expect(vi.mocked(runTemplateFromFolder).mock.calls[0][2]).toEqual({
				choiceExecutor: executor,
			});
			expect(executed).toEqual([]);
		});
	});

	// Issue #1540: the launcher's input rendered completely blank; every Obsidian
	// picker labels its own.
	describe("placeholder", () => {
		it("labels the top level with a default hint", () => {
			expect(makeSuggester(rootChoices).inputEl.placeholder).toBe(
				"Select a choice",
			);
		});

		it("lets an explicit placeholder win", () => {
			const s = new ChoiceSuggester(plugin, rootChoices, {
				choiceExecutor: executor,
				placeholder: "  Pick a meeting  ",
			});

			expect(s.inputEl.placeholder).toBe("Pick a meeting");
		});

		it("falls back to the default for a blank explicit placeholder", () => {
			const s = new ChoiceSuggester(plugin, rootChoices, {
				choiceExecutor: executor,
				placeholder: "   ",
			});

			expect(s.inputEl.placeholder).toBe("Select a choice");
		});

		it("restores the level's own hint when Back re-opens it", () => {
			const s = new ChoiceSuggester(plugin, [makeBack(rootChoices)], {
				choiceExecutor: executor,
				placeholder: "Work",
				placeholderStack: ["Select a choice"],
			});
			const openSpy = vi
				.spyOn(ChoiceSuggester, "Open")
				.mockImplementation(() => {});

			s.onChooseItem(s.getItems()[0], new MouseEvent("click"));

			const [, , options] = openSpy.mock.calls[0] as unknown as [
				QuickAdd,
				IChoice[],
				{ placeholder?: string; placeholderStack?: Array<string | undefined> },
			];
			expect(options.placeholder).toBe("Select a choice");
			expect(options.placeholderStack).toEqual([]);
		});
	});

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
			const drilledLevel = [...work.choices!, makeBack(rootChoices)];
			const suggester = makeSuggester(drilledLevel);

			expect(
				suggester.getSuggestions("top").map((s) => s.item)
			).not.toContain(topNote);
			expect(
				suggester.getSuggestions("back").map((s) => s.item.id)
			).not.toContain(BACK_CHOICE_ID);
		});

		it("keeps the back item in the empty-query view", () => {
			const drilledLevel = [...work.choices!, makeBack(rootChoices)];
			const suggester = makeSuggester(drilledLevel);

			const ids = suggester.getSuggestions("").map((s) => s.item.id);

			expect(ids).toContain(BACK_CHOICE_ID);
		});

		it("excludes ancestor back items after navigating back from depth 2", () => {
			// Drill root -> Work -> Meetings, then press Back: the restored level
			// is back_meetings.choices, which still contains back_work. The
			// sentinel id must catch that ancestor back item statelessly.
			const workLevel = [...work.choices!, makeBack(rootChoices)];
			const meetingsLevel = [...meetings.choices!, makeBack(workLevel)];
			const backToWork = meetingsLevel[meetingsLevel.length - 1] as IMultiChoice;

			const restored = makeSuggester([...backToWork.choices!]);
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

		it("executes leaves with a focused property captured before the suggester opened", () => {
			const focusedProperty = {
				file: { path: "Host.md" },
				key: "related",
			} as FrontmatterPropertyTarget;
			const executeWithFocusedProperty = vi.fn(async () => {});
			executor.executeWithFocusedProperty = executeWithFocusedProperty;
			const suggester = makeSuggester(rootChoices, { focusedProperty });

			suggester.onChooseItem(newMeeting, new MouseEvent("click"));

			expect(executeWithFocusedProperty).toHaveBeenCalledWith(
				newMeeting,
				focusedProperty,
				// Trigger context (issue #1429) is threaded as the 3rd arg; the stub
				// workspace has no active file.
				{ activeFile: null },
			);
			expect(executed).toEqual([]);
		});

		it("captures the focused property by default for a top-level suggester", () => {
			const focusedProperty = {
				file: { path: "Host.md" },
				key: "related",
			} as FrontmatterPropertyTarget;
			vi.mocked(getFocusedPropertyTarget).mockReturnValue(focusedProperty);
			const executeWithFocusedProperty = vi.fn(async () => {});
			executor.executeWithFocusedProperty = executeWithFocusedProperty;

			const suggester = makeSuggester(rootChoices);
			suggester.onChooseItem(newMeeting, new MouseEvent("click"));

			expect(getFocusedPropertyTarget).toHaveBeenCalledWith(app);
			expect(executeWithFocusedProperty).toHaveBeenCalledWith(
				newMeeting,
				focusedProperty,
				// Trigger context (issue #1429) is threaded as the 3rd arg; the stub
				// workspace has no active file.
				{ activeFile: null },
			);
			expect(executed).toEqual([]);
		});

		it("appends a sentinel back item when drilling into a Multi", () => {
			const openSpy = vi
				.spyOn(ChoiceSuggester, "Open")
				.mockImplementation(() => {});
			const focusedProperty = {
				file: { path: "Host.md" },
				key: "related",
			} as FrontmatterPropertyTarget;
			const suggester = makeSuggester(rootChoices, { focusedProperty });

			suggester.onChooseItem(work, new MouseEvent("click"));

			const [, passedChoices, options] = openSpy.mock.calls[0] as unknown as [
				QuickAdd,
				IChoice[],
				{
					choiceExecutor?: IChoiceExecutor;
					focusedProperty?: FrontmatterPropertyTarget | null;
					triggerContext?: { activeFile: unknown } | null;
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
			expect(options.focusedProperty).toBe(focusedProperty);
			// The trigger context (issue #1429) is threaded down so a leaf choice
			// still defaults from the original trigger note, not a re-read.
			expect(options.triggerContext).toEqual({ activeFile: null });
			expect(options.placeholder).toBe("Work");
			// The stack records the level we came FROM, so Back restores the
			// launcher's default hint rather than a blank input (issue #1540).
			expect(options.placeholderStack).toEqual(["Select a choice"]);
		});

		it("threads a captured trigger context to the leaf execution (issue #1429)", () => {
			const triggerContext = {
				activeFile: { path: "Trigger.md", extension: "md" },
			} as never;
			const executeWithFocusedProperty = vi.fn(async () => {});
			executor.executeWithFocusedProperty = executeWithFocusedProperty;
			// Simulate a nested level that received the context from its parent.
			const suggester = makeSuggester(rootChoices, {
				triggerContext,
			} as never);

			suggester.onChooseItem(newMeeting, new MouseEvent("click"));

			expect(executeWithFocusedProperty).toHaveBeenCalledWith(
				newMeeting,
				null,
				triggerContext,
			);
		});

		it("navigates back without appending another back item", () => {
			const openSpy = vi
				.spyOn(ChoiceSuggester, "Open")
				.mockImplementation(() => {});
			const drilledLevel = [...work.choices!, makeBack(rootChoices)];
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

		// Backstop only: the picker itself never reaches this, because
		// selectSuggestion refuses an empty folder before the modal closes (#1554).
		// Programmatic callers still get the notice rather than a level whose only
		// row is "← Back".
		it("refuses to open an empty folder and says why", () => {
			const openSpy = vi
				.spyOn(ChoiceSuggester, "Open")
				.mockImplementation(() => {});
			const empty = multi("Reading", []);
			(Notice as unknown as { instances: unknown[] }).instances = [];

			makeSuggester([topNote, empty]).onChooseItem(
				empty,
				new MouseEvent("click"),
			);

			expect(
				(Notice as unknown as { instances: Array<{ message: string }> })
					.instances.map((n) => n.message),
			).toEqual(['Folder "Reading" is empty.']);
			expect(openSpy).not.toHaveBeenCalled();
		});

		// ...but Back must still work even when the level it returns to is empty,
		// since the back item carries the previous level as its payload.
		it("still navigates back when the back item wraps an empty level", () => {
			const openSpy = vi
				.spyOn(ChoiceSuggester, "Open")
				.mockImplementation(() => {});
			const back = makeBack([]);

			makeSuggester([back]).onChooseItem(back, new MouseEvent("click"));

			const [, passedChoices] = openSpy.mock.calls[0] as unknown as [
				QuickAdd,
				IChoice[],
			];
			expect(passedChoices).toEqual([]);
		});
	});

	// An empty folder is a dead end, and the row now says so before the click
	// (#1554). Activation is refused in selectSuggestion — the only seam above
	// SuggestModal's close() — so the picker keeps its query and selection.
	describe("selectSuggestion (empty folders)", () => {
		function activate(
			suggester: ChoiceSuggester,
			item: IChoice,
			evt: MouseEvent | KeyboardEvent = new MouseEvent("click"),
		) {
			suggester.selectSuggestion({ item, match: { score: 0, matches: [] } }, evt);
		}

		function noticeMessages(): string[] {
			return (
				Notice as unknown as { instances: Array<{ message: string }> }
			).instances.map((n) => n.message);
		}

		beforeEach(() => {
			(Notice as unknown as { instances: unknown[] }).instances = [];
		});

		it("refuses the activation, keeps the picker open, and restores input focus", () => {
			const openSpy = vi
				.spyOn(ChoiceSuggester, "Open")
				.mockImplementation(() => {});
			const empty = multi("Reading", []);
			const suggester = makeSuggester([topNote, empty]);
			// Real Obsidian's close() and onChooseSuggestion() are one indivisible
			// expression, so "onChooseItem did not run" is what actually pins that
			// super.selectSuggestion was skipped.
			const onChooseItem = vi.spyOn(suggester, "onChooseItem");
			const close = vi.spyOn(suggester, "close");
			const focus = vi.spyOn(suggester.inputEl, "focus");

			activate(suggester, empty);

			expect(noticeMessages()).toEqual(['Folder "Reading" is empty.']);
			expect(onChooseItem).not.toHaveBeenCalled();
			expect(close).not.toHaveBeenCalled();
			expect(openSpy).not.toHaveBeenCalled();
			// A trusted mousedown on the row moves focus to <body>; nothing closes the
			// modal any more, so the input has to be handed focus back.
			expect(focus).toHaveBeenCalledTimes(1);
		});

		it("ignores key auto-repeat so a held Enter cannot stack notices", () => {
			const empty = multi("Reading", []);
			const suggester = makeSuggester([empty]);

			activate(suggester, empty, new KeyboardEvent("keydown"));
			for (let i = 0; i < 5; i++) {
				activate(suggester, empty, new KeyboardEvent("keydown", { repeat: true }));
			}

			expect(noticeMessages()).toEqual(['Folder "Reading" is empty.']);
		});

		it("treats a folder with no choices array (corrupt data.json) as empty", () => {
			const broken = {
				...multi("Broken", []),
				choices: undefined,
			} as unknown as IChoice;
			const suggester = makeSuggester([broken]);
			const onChooseItem = vi.spyOn(suggester, "onChooseItem");

			expect(() => activate(suggester, broken)).not.toThrow();
			expect(noticeMessages()).toEqual(['Folder "Broken" is empty.']);
			expect(onChooseItem).not.toHaveBeenCalled();
		});

		it("lets a folder with choices through to the drill-down", () => {
			const openSpy = vi
				.spyOn(ChoiceSuggester, "Open")
				.mockImplementation(() => {});
			const suggester = makeSuggester(rootChoices);

			activate(suggester, work);

			expect(noticeMessages()).toEqual([]);
			const [, passedChoices] = openSpy.mock.calls[0] as unknown as [
				QuickAdd,
				IChoice[],
			];
			expect(passedChoices.map((c) => c.id)).toEqual([
				...work.choices!.map((c) => c.id),
				BACK_CHOICE_ID,
			]);
		});

		it("lets the back row through even when the level it returns to is empty", () => {
			const openSpy = vi
				.spyOn(ChoiceSuggester, "Open")
				.mockImplementation(() => {});
			const back = makeBack([]);
			const suggester = makeSuggester([back]);

			activate(suggester, back);

			expect(noticeMessages()).toEqual([]);
			const [, passedChoices] = openSpy.mock.calls[0] as unknown as [
				QuickAdd,
				IChoice[],
			];
			expect(passedChoices).toEqual([]);
		});

		it("keeps empty folders in the results — they are marked, never hidden", () => {
			const empty = multi("Reading", []);
			const suggester = makeSuggester([topNote, empty]);

			expect(
				suggester.getSuggestions("").map((s) => s.item.id),
			).toContain(empty.id);
			expect(
				suggester.getSuggestions("read").map((s) => s.item.id),
			).toContain(empty.id);
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

		it("renders the default choice-type icon", async () => {
			const suggester = makeSuggester(rootChoices);

			const el = await render(suggester, topNote);

			expect(el.querySelector(".quickadd-choice-icon svg")).toHaveAttribute(
				"data-icon",
				"file-text",
			);
		});

		it("renders a per-choice icon override", async () => {
			const starred = { ...choice("Starred"), icon: "star" };
			const suggester = makeSuggester([starred]);

			const el = await render(suggester, starred);

			expect(el.querySelector(".quickadd-choice-icon svg")).toHaveAttribute(
				"data-icon",
				"star",
			);
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

		// #1554: the dead end has to be visible before the click, not only after it.
		describe("empty folders", () => {
			function flairOf(el: HTMLElement): HTMLElement | null {
				return el.querySelector(
					".quickadd-choice-suggestion-content > .quickadd-choice-suggestion-empty-flair",
				);
			}

			it("marks an empty folder with a dimming class, aria-disabled and a flair", async () => {
				const empty = multi("Reading", []);
				const suggester = makeSuggester([topNote, empty]);

				const el = await render(suggester, empty);

				expect(
					el.classList.contains("quickadd-choice-suggestion-empty"),
				).toBe(true);
				expect(el.getAttribute("aria-disabled")).toBe("true");
				expect(flairOf(el)?.textContent).toBe("Empty");
			});

			it("marks nested-search results too, keeping the flair last in the row", async () => {
				const nestedEmpty = multi("Reading", []);
				const parent = multi("Library", [nestedEmpty]);
				const suggester = makeSuggester([parent]);
				suggester.getSuggestions("read");

				const el = await render(suggester, nestedEmpty);

				// The breadcrumb branch renders a different subtree; the marker has to
				// survive it, since renderSuggestion is the single render path.
				expect(el.classList.contains("mod-complex")).toBe(true);
				expect(el.querySelector(".suggestion-note")?.textContent).toBe(
					"Library",
				);
				expect(
					el.classList.contains("quickadd-choice-suggestion-empty"),
				).toBe(true);
				const row = el.querySelector(".quickadd-choice-suggestion-content");
				expect(row?.lastElementChild).toBe(flairOf(el));
			});

			it("marks a folder whose choices array is missing (corrupt data.json)", async () => {
				const broken = {
					...multi("Broken", []),
					choices: undefined,
				} as unknown as IChoice;
				const suggester = makeSuggester([broken]);

				const el = await render(suggester, broken);

				expect(flairOf(el)?.textContent).toBe("Empty");
			});

			it("leaves folders with choices, leaf choices and the back row unmarked", async () => {
				const back = makeBack([]);
				const suggester = makeSuggester([work, topNote, back]);

				for (const item of [work, topNote, back]) {
					const el = await render(suggester, item);
					expect(
						el.classList.contains("quickadd-choice-suggestion-empty"),
					).toBe(false);
					expect(el.hasAttribute("aria-disabled")).toBe(false);
					expect(flairOf(el)).toBeNull();
				}
			});

			it("clears the marker when a row element is reused for a normal choice", async () => {
				const empty = multi("Reading", []);
				const suggester = makeSuggester([empty, topNote]);
				const el = document.createElement("div");

				suggester.renderSuggestion(
					{ item: empty, match: { score: 0, matches: [] } },
					el,
				);
				suggester.renderSuggestion(
					{ item: topNote, match: { score: 0, matches: [] } },
					el,
				);
				await Promise.resolve();

				expect(
					el.classList.contains("quickadd-choice-suggestion-empty"),
				).toBe(false);
				expect(el.hasAttribute("aria-disabled")).toBe(false);
				expect(flairOf(el)).toBeNull();
			});
		});

		it("does not render an icon for the sentinel back item", async () => {
			const back = makeBack(rootChoices);
			const suggester = makeSuggester([back]);

			const el = await render(suggester, back);

			expect(el.querySelector(".quickadd-choice-icon")).toBeNull();
		});

		it("uses a create-file icon for the template-folder launcher row", async () => {
			const row: IChoice = {
				id: RUN_TEMPLATE_FROM_FOLDER_ID,
				name: "New note from template…",
				type: "Template",
				command: false,
			};
			const suggester = makeSuggester([row]);

			const el = await render(suggester, row);

			expect(el.querySelector(".quickadd-choice-icon svg")).toHaveAttribute(
				"data-icon",
				"file-plus",
			);
		});
	});

	// The completion is what lets an awaiting run (ChoiceExecutor's Multi path,
	// #1630) finish only when the picked choice actually has - or learn that the
	// picker was dismissed.
	describe("completion (#1630)", () => {
		function makeCompletion() {
			return vi.fn<(error?: unknown) => void>();
		}

		function completionSuggester(
			choices: IChoice[],
			completion: (error?: unknown) => void,
		): ChoiceSuggester {
			return new ChoiceSuggester(plugin, choices, {
				choiceExecutor: executor,
				completion,
			});
		}

		const flushMicrotasks = () => new Promise<void>((r) => setTimeout(r, 0));

		it("resolves only after the picked leaf's run settles", async () => {
			let finishLeaf: () => void = () => {};
			executor.execute = () =>
				new Promise<void>((resolve) => {
					finishLeaf = resolve;
				});
			const completion = makeCompletion();
			const suggester = completionSuggester(rootChoices, completion);

			suggester.selectSuggestion(
				{ item: topNote, match: { score: 0, matches: [] } },
				new MouseEvent("click"),
			);
			await flushMicrotasks();
			expect(completion).not.toHaveBeenCalled();

			finishLeaf();
			await flushMicrotasks();
			expect(completion).toHaveBeenCalledTimes(1);
			expect(completion).toHaveBeenCalledWith();
		});

		it("rejects with the leaf's own error instance", async () => {
			const leafError = new Error("leaf blew up");
			executor.execute = () => Promise.reject(leafError);
			const completion = makeCompletion();
			const suggester = completionSuggester(rootChoices, completion);

			suggester.selectSuggestion(
				{ item: topNote, match: { score: 0, matches: [] } },
				new MouseEvent("click"),
			);
			await flushMicrotasks();

			expect(completion).toHaveBeenCalledWith(leafError);
		});

		it("rejects as a cancellation when the picker closes without a pick", () => {
			const completion = makeCompletion();
			const suggester = completionSuggester(rootChoices, completion);

			suggester.onClose();

			expect(completion).toHaveBeenCalledTimes(1);
			expect(completion.mock.calls[0][0]).toBeInstanceOf(UserCancelError);
		});

		it("does not treat an accepted pick's close as a dismissal", async () => {
			const completion = makeCompletion();
			const suggester = completionSuggester(rootChoices, completion);

			// Real Obsidian closes the modal (onClose) between selectSuggestion and
			// onChooseItem; the dispatched flag is what disambiguates.
			suggester.selectSuggestion(
				{ item: topNote, match: { score: 0, matches: [] } },
				new MouseEvent("click"),
			);
			suggester.onClose();
			await flushMicrotasks();

			expect(completion).toHaveBeenCalledTimes(1);
			expect(completion).toHaveBeenCalledWith();
		});

		it("threads the completion through a folder drill-down", () => {
			const openSpy = vi
				.spyOn(ChoiceSuggester, "Open")
				.mockImplementation(() => {});
			const completion = makeCompletion();
			const suggester = completionSuggester(rootChoices, completion);

			suggester.selectSuggestion(
				{ item: work, match: { score: 0, matches: [] } },
				new MouseEvent("click"),
			);

			expect(openSpy).toHaveBeenCalledTimes(1);
			expect(openSpy.mock.calls[0][2]?.completion).toBe(completion);
			// Handed down, not settled: the nested level owns it now.
			expect(completion).not.toHaveBeenCalled();
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

describe("emptyFolderNoticeText over a malformed folder (#1566)", () => {
	const brokenFolder = (children: unknown): IChoice => {
		const node: Record<string, unknown> = {
			id: "broken",
			name: "Broken",
			type: "Multi",
			command: false,
			collapsed: false,
		};
		if (children !== undefined) node.choices = children;
		return node as unknown as IChoice;
	};

	it("calls a folder that lost nothing empty", () => {
		for (const value of [undefined, null, {}, []]) {
			expect(emptyFolderNoticeText(brokenFolder(value))).toBe(
				'Folder "Broken" is empty.',
			);
		}
	});

	it("does not call a folder empty when its contents merely could not be read", () => {
		// Otherwise the picker contradicts the settings list about the same folder.
		expect(emptyFolderNoticeText(brokenFolder({ "0": {} }))).toContain(
			"couldn't read the contents",
		);
	});
});
