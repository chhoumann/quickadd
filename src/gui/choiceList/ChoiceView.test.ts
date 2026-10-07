// @vitest-environment jsdom
import { App } from "obsidian";
import type QuickAdd from "../../main";
import ChoiceView from "./ChoiceView.svelte";
import { renderChoiceView } from "../../../tests/helpers/settings/choiceView";
import { describe, expect, it, vi } from "vitest";

// Folder adds now auto-open the rename prompt; stub it so these component tests
// don't block on a real modal (resolving undefined = the user cancelled rename,
// which keeps the default name).
vi.mock("../choiceRename", () => ({
	promptRenameChoice: vi.fn().mockResolvedValue(undefined),
}));

import { fireEvent, render } from "@testing-library/svelte";
import { promptRenameChoice } from "../choiceRename";
import type IChoice from "../../types/choices/IChoice";
import type { Plain } from "../svelte/persist.svelte";

// A Macro choice whose macro holds a Conditional command with a populated Then
// branch — mirrors the on-disk shape the local obsidian-e2e test seeds. Built as
// a plain object (the persisted representation) cast to IChoice.
const conditionalMacroChoice = (): IChoice =>
	({
		id: "cond-macro",
		name: "QA Conditional Macro",
		type: "Macro",
		command: false,
		runOnStartup: false,
		macro: {
			id: "cond-macro-macro",
			name: "QA Conditional Macro",
			commands: [
				{
					id: "cond-1",
					name: "If condition",
					type: "Conditional",
					condition: {
						mode: "variable",
						variableName: "",
						operator: "isTruthy",
						valueType: "string",
					},
					thenCommands: [
						{ id: "wait-1", name: "Wait", type: "Wait", time: 100 },
					],
					elseCommands: [],
				},
			],
		},
	}) as unknown as IChoice;

const findConditional = (choices: Plain<IChoice[]>) => {
	const macro = choices.find((c) => c.id === "cond-macro") as
		| undefined
		| { macro: { commands: Array<{ id: string; thenCommands?: unknown[] }> } };
	return macro?.macro.commands.find((c) => c.id === "cond-1");
};


describe("ChoiceView", () => {
	// The headline goal of #1249: ChoiceView's import graph no longer has the
	// circular dependency that threw `Class extends value undefined`, so it can be
	// mounted in a CI vitest component test at all.
	it("mounts in vitest without the circular-import crash", () => {
		const { getByLabelText } = renderChoiceView([
			conditionalMacroChoice(),
		]);

		// Renders the seeded macro choice row (aria-label = `Configure <name>`).
		expect(
			getByLabelText("Configure QA Conditional Macro"),
		).toBeInTheDocument();
		// And the view chrome that proves the full subtree rendered.
		expect(getByLabelText("New choice")).toBeInTheDocument();
	});

	// Complements the local obsidian-e2e conditional-branch-persistence test in CI:
	// drives ChoiceView's real save path and asserts the conditional Then-branch
	// data survives the snapshot persistence boundary intact and plain.
	it("persists conditional Then-branch data through saveChoices as a plain snapshot", async () => {
		const saveChoices =
			vi.fn<(next: Plain<IChoice[]>) => void>();
		const { getByLabelText } = renderChoiceView(
			[conditionalMacroChoice()],
			saveChoices,
		);

		// Drive the real save path: "New folder" adds a choice directly (no type
		// menu, no builder modal to stub) -> ChoiceView.save().
		await fireEvent.click(getByLabelText("New folder"));

		await vi.waitFor(() => expect(saveChoices).toHaveBeenCalledTimes(1));

		const saved = saveChoices.mock.calls[0][0];
		// The new choice was appended...
		expect(saved.map((c) => c.name)).toEqual([
			"QA Conditional Macro",
			"New folder",
		]);
		// ...and the pre-existing conditional's Then branch survives with full nested
		// fidelity (not just length) — the exact data-loss the e2e test guards against.
		const cond = findConditional(saved);
		expect(cond?.thenCommands).toEqual([
			{ id: "wait-1", name: "Wait", type: "Wait", time: 100 },
		]);
		// Persisted payload is a plain, JSON-serializable snapshot (no $state Proxy).
		expect(JSON.parse(JSON.stringify(saved))).toEqual(saved);
	});

	// Regression for "folders won't open/close on click after a reload": the toggle
	// must be reactive on the FIRST render, before any add/delete/reorder/drag has
	// reassigned (and thus proxied) the choices array. A plain mounted array is the
	// real shape (settingsStore.getState().choices), so this reproduces the bug.
	it("collapses a folder on click on first render (no prior reassignment)", async () => {
		const folderChoice = {
			id: "f1",
			name: "Folder",
			type: "Multi",
			collapsed: false,
			choices: [{ id: "c1", name: "Child", type: "Template" }],
		} as unknown as IChoice;

		const { getByLabelText, queryByLabelText } = renderChoiceView([
			folderChoice,
		]);

		const toggle = getByLabelText("Toggle Folder");
		expect(toggle.getAttribute("aria-expanded")).toBe("true");
		expect(queryByLabelText("Delete Child")).not.toBeNull(); // child visible

		await fireEvent.click(toggle);

		// Collapsed: aria flips and the nested child unmounts.
		expect(toggle.getAttribute("aria-expanded")).toBe("false");
		expect(queryByLabelText("Delete Child")).toBeNull();

		await fireEvent.click(toggle); // and back open
		expect(toggle.getAttribute("aria-expanded")).toBe("true");
	});

	// The filtered view renders a derived, force-expanded clone; toggling a folder
	// there must NOT persist the real tree (else it silently collapses the real
	// folder, visible only after the filter clears).
	it("does not persist collapse from the filtered (derived) view", async () => {
		const saveChoices = vi.fn<(next: Plain<IChoice[]>) => void>();
		const folderChoice = {
			id: "f1",
			name: "Folder",
			type: "Multi",
			collapsed: false,
			choices: [{ id: "c1", name: "Findable", type: "Template" }],
		} as unknown as IChoice;

		const { getByLabelText, getByPlaceholderText } = renderChoiceView(
			[folderChoice],
			saveChoices,
		);

		// Activate the filter so the derived, force-expanded clone renders.
		await fireEvent.input(getByPlaceholderText("Filter choices..."), {
			target: { value: "Findable" },
		});

		// The folder toggle in the filtered view must be inert (no persistence).
		await fireEvent.click(getByLabelText("Toggle Folder"));
		expect(saveChoices).not.toHaveBeenCalled();
	});

	// Regression: editing a folder from the FILTERED view must not drop the folder's
	// hidden (non-matching) children. The filtered render is a truncated clone, so the
	// edit handlers resolve the live choice by id (liveChoice) before merging — the real
	// folder keeps every child on save. Command-toggle is the representative destructive
	// path; rename and configure(Multi) share the same updateChoiceHelper merge.
	it("keeps a folder's hidden children when editing it from the filtered view", async () => {
		const saveChoices = vi.fn<(next: Plain<IChoice[]>) => void>();
		const folderChoice = {
			id: "f1",
			name: "Inbox",
			type: "Multi",
			collapsed: false,
			command: false,
			choices: [
				{ id: "c1", name: "Findme", type: "Template", command: false },
				{ id: "c2", name: "Hidden", type: "Template", command: false },
			],
		} as unknown as IChoice;

		const { getByLabelText, getByPlaceholderText } = render(ChoiceView, {
			props: {
				app: new App() as never,
				// Command toggle is the only path that touches the plugin; stub the two
				// registry methods it calls so the toggle doesn't throw.
				plugin: {
					addCommandForChoice: vi.fn(),
					removeCommandForChoice: vi.fn(),
				} as unknown as QuickAdd,
				choices: [folderChoice],
				saveChoices,
				openAISettings: vi.fn(),
			},
		});

		// Filter so only "Findme" matches -> the folder renders as a clone WITHOUT "Hidden".
		await fireEvent.input(getByPlaceholderText("Filter choices..."), {
			target: { value: "Findme" },
		});

		// Toggle the folder's command from that truncated-clone row.
		await fireEvent.click(getByLabelText("Command palette: Inbox"));

		await vi.waitFor(() => expect(saveChoices).toHaveBeenCalled());
		const saved = saveChoices.mock.calls.at(-1)![0];
		const folder = saved.find((c) => c.id === "f1") as
			| { command: boolean; choices: Array<{ name: string }> }
			| undefined;
		expect(folder?.command).toBe(true); // the edit took effect...
		// ...and BOTH children survived, not just the filter-matching one.
		expect(folder?.choices.map((c) => c.name)).toEqual(["Findme", "Hidden"]);
	});

	// Same data-loss class via a SEPARATE handler: duplicating a folder from the
	// filtered view must copy the whole folder, not the truncated clone. Guards
	// handleDuplicateChoice independently of the command-toggle/merge path above.
	it("duplicates the whole folder (not the filtered clone) from the filtered view", async () => {
		const saveChoices = vi.fn<(next: Plain<IChoice[]>) => void>();
		const folderChoice = {
			id: "f1",
			name: "Inbox",
			type: "Multi",
			collapsed: false,
			command: false,
			choices: [
				{ id: "c1", name: "Findme", type: "Template", command: false },
				{ id: "c2", name: "Hidden", type: "Template", command: false },
			],
		} as unknown as IChoice;

		const { getByLabelText, getByPlaceholderText } = render(ChoiceView, {
			props: {
				app: new App() as never,
				plugin: {} as unknown as QuickAdd,
				choices: [folderChoice],
				saveChoices,
				openAISettings: vi.fn(),
			},
		});

		await fireEvent.input(getByPlaceholderText("Filter choices..."), {
			target: { value: "Findme" },
		});

		// Duplicate from the truncated-clone row (a one-click row button).
		await fireEvent.click(getByLabelText("Duplicate Inbox"));

		await vi.waitFor(() => expect(saveChoices).toHaveBeenCalled());
		const saved = saveChoices.mock.calls.at(-1)![0];
		const copy = saved.find((c) => c.name === "Inbox (copy)") as
			| { choices: Array<{ name: string }> }
			| undefined;
		expect(copy).toBeDefined();
		// The copy has BOTH children (duplicateChoice appends "(copy)" to each) — the original
		// folder was duplicated, not the filtered clone (which would yield only "Findme (copy)").
		expect(copy?.choices.map((c) => c.name)).toEqual([
			"Findme (copy)",
			"Hidden (copy)",
		]);
	});

	// #2123: filtering by a folder's own name showed it with the empty-folder hint,
	// because none of its choices matched by their own names.
	it("shows everything under a folder whose name matches the filter", async () => {
		const folderChoice = {
			id: "f1",
			name: "Personal",
			type: "Multi",
			collapsed: true,
			choices: [
				{ id: "c1", name: "Groceries", type: "Capture" },
				{
					id: "f2",
					name: "Lists",
					type: "Multi",
					collapsed: true,
					choices: [{ id: "c2", name: "Packing", type: "Capture" }],
				},
			],
		} as unknown as IChoice;
		const other = { id: "c3", name: "Inbox", type: "Capture" } as unknown as IChoice;
		const { container, getByPlaceholderText } = renderChoiceView([folderChoice, other]);

		await fireEvent.input(getByPlaceholderText("Filter choices..."), {
			target: { value: "Personal" },
		});

		const rows = Array.from(container.querySelectorAll("[data-choice-id]"), (row) =>
			row.getAttribute("data-choice-id"));
		expect(rows).toEqual(["f1", "c1", "f2", "c2"]);
		expect(container.querySelector(".qa-folder-empty")).toBeNull();
	});

	it("shows only the matching choices of a matching folder when some match", async () => {
		const folderChoice = {
			id: "f1",
			name: "Projects",
			type: "Multi",
			collapsed: true,
			choices: [
				{ id: "c1", name: "Project idea", type: "Capture" },
				{ id: "c2", name: "Budget", type: "Capture" },
			],
		} as unknown as IChoice;
		const { container, getByPlaceholderText } = renderChoiceView([folderChoice]);

		await fireEvent.input(getByPlaceholderText("Filter choices..."), {
			target: { value: "project" },
		});

		const rows = Array.from(container.querySelectorAll("[data-choice-id]"), (row) =>
			row.getAttribute("data-choice-id"));
		expect(rows).toEqual(["f1", "c1"]);
	});

	// A folder name matches only as plain text, so a loose fuzzy match ("pro" in
	// "Personal") neither opens the whole folder nor shows it empty.
	it("shows a folder that only matches fuzzily just for its matching choices", async () => {
		const choices = [
			{
				id: "work",
				name: "Work",
				type: "Multi",
				collapsed: true,
				choices: [
					{ id: "task", name: "Work task", type: "Capture" },
					{
						id: "projects",
						name: "Projects",
						type: "Multi",
						collapsed: true,
						choices: [
							{ id: "idea", name: "Project idea", type: "Capture" },
							{ id: "budget", name: "Budget", type: "Capture" },
						],
					},
				],
			},
			{
				id: "personal",
				name: "Personal",
				type: "Multi",
				collapsed: true,
				choices: [
					{ id: "groceries", name: "Groceries", type: "Capture" },
					{ id: "book", name: "Book to read", type: "Capture" },
				],
			},
			{
				id: "paperwork",
				name: "Paperwork",
				type: "Multi",
				collapsed: true,
				choices: [
					{ id: "receipts", name: "Receipts", type: "Capture" },
					{ id: "prompts", name: "Prompt ideas", type: "Capture" },
				],
			},
		] as unknown as IChoice[];
		const { container, getByPlaceholderText } = renderChoiceView(choices);

		await fireEvent.input(getByPlaceholderText("Filter choices..."), {
			target: { value: "pro" },
		});

		const rows = Array.from(container.querySelectorAll("[data-choice-id]"), (row) =>
			row.getAttribute("data-choice-id"));
		expect(rows).toEqual(["work", "projects", "idea", "paperwork", "prompts"]);
		expect(container.querySelector(".qa-folder-empty")).toBeNull();
	});

	// Malformed data.json: a folder whose name isn't a string must not break filtering.
	it("filters past a folder whose name is not a string", async () => {
		const choices = [
			{ id: "bad", name: 42, type: "Multi", collapsed: false, choices: [{ id: "c1", name: "Inbox", type: "Capture" }] },
		] as unknown as IChoice[];
		const { container, getByPlaceholderText } = renderChoiceView(choices);

		await fireEvent.input(getByPlaceholderText("Filter choices..."), {
			target: { value: "inbox" },
		});

		const rows = Array.from(container.querySelectorAll("[data-choice-id]"), (row) =>
			row.getAttribute("data-choice-id"));
		expect(rows).toEqual(["bad", "c1"]);
	});

	// #2107: narrowing the filter must not lay out the list once per row that
	// leaves. Svelte's animate measures every row (getBoundingClientRect) when a
	// keyed list loses one, which took ~400 ms a keystroke at a few hundred rows.
	it("does not measure the rows when the filter drops some", async () => {
		const choices = Array.from({ length: 20 }, (_, i) => ({
			id: `c${i}`,
			name: i % 2 === 0 ? `Capture ${i}` : `Template ${i}`,
			type: "Template",
		})) as unknown as IChoice[];
		const { container, getByPlaceholderText } = renderChoiceView(choices);
		const filter = getByPlaceholderText("Filter choices...");
		await fireEvent.input(filter, { target: { value: "t" } });
		expect(container.querySelectorAll(".choiceListItem")).toHaveLength(20);

		const measure = vi.spyOn(Element.prototype, "getBoundingClientRect");
		try {
			await fireEvent.input(filter, { target: { value: "capture" } });
			expect(container.querySelectorAll(".choiceListItem")).toHaveLength(10);
			expect(measure).not.toHaveBeenCalled();
		} finally {
			measure.mockRestore();
		}
	});

	// Covers the redesign's novel add-into-folder path end-to-end through the
	// real component DOM (the per-folder "New folder" affordance), which the
	// Obsidian Menu / builder modal can't be synthetically driven to exercise.
	it("adds into an expanded folder and keeps it expanded", async () => {
		const saveChoices = vi.fn<(next: Plain<IChoice[]>) => void>();
		const folderChoice = {
			id: "f1",
			name: "Folder",
			type: "Multi",
			collapsed: false,
			choices: [{ id: "c1", name: "Child", type: "Template" }],
		} as unknown as IChoice;

		const { findByLabelText } = renderChoiceView([folderChoice], saveChoices);

		// The per-folder affordance inside the expanded folder adds INTO it
		// (its tooltip/label names the target folder).
		await fireEvent.click(await findByLabelText("Add folder to Folder"));

		await vi.waitFor(() => expect(saveChoices).toHaveBeenCalled());
		const saved = saveChoices.mock.calls.at(-1)![0];
		const folder = saved.find((c) => c.id === "f1") as
			| { collapsed: boolean; choices: Array<{ name: string }> }
			| undefined;
		// New folder landed inside f1 (after its child) and f1 stayed expanded.
		expect(folder?.collapsed).toBe(false);
		expect(folder?.choices.map((c) => c.name)).toEqual([
			"Child",
			"New folder",
		]);
	});

	// Issue #1541: the first-run empty state is the one place a brand-new user is
	// guaranteed to look, so it carries the plugin's most prominent docs link.
	it("links the documentation from the empty state", () => {
		const { container } = renderChoiceView([], vi.fn());

		const link = container.querySelector("a");
		expect(link?.getAttribute("href")).toBe(
			"https://quickadd.obsidian.guide/docs/",
		);
		expect(link?.getAttribute("target")).toBe("_blank");
		expect(link?.getAttribute("rel")).toBe("noopener noreferrer");
	});

	// Issue #1539: the rename prompt that follows "New folder" must be told it is
	// naming a folder, so its header reads "Folder name" and not "Choice name".
	it("passes the choice type to the rename prompt so folders say 'folder'", async () => {
		const { getByLabelText } = renderChoiceView([], vi.fn());

		await fireEvent.click(getByLabelText("New folder"));

		await vi.waitFor(() => expect(promptRenameChoice).toHaveBeenCalled());
		expect(promptRenameChoice).toHaveBeenCalledWith(
			expect.anything(),
			"New folder",
			"Multi",
		);
	});
});
