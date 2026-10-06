import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, waitFor, within } from "@testing-library/svelte";
import type { App } from "obsidian";
import { settingsStore } from "../../settingsStore";
import type * as PackageImportService from "../../services/packageImportService";
import { applyPackageImport } from "../../services/packageImportService";
import { RECIPES } from "./catalog";
import RecipesModal from "./RecipesModal.svelte";

vi.mock("../../services/packageImportService", async (importOriginal) => {
	const actual = await importOriginal<typeof PackageImportService>();
	return {
		...actual,
		applyPackageImport: vi.fn(async () => ({
			updatedChoices: [],
			addedChoiceIds: ["qa-pkg-meeting-notes", "qa-pkg-meeting-notes-project-update"],
			overwrittenChoiceIds: [],
			skippedChoiceIds: [],
			writtenAssets: ["Templates/Meeting.md", "Templates/Project update.md"],
			skippedAssets: [],
		})),
	};
});

function fakeApp(): App {
	return {
		vault: {
			adapter: {
				exists: vi.fn(async () => false),
				read: vi.fn(async () => ""),
			},
			getAbstractFileByPath: vi.fn(() => null),
		},
	} as unknown as App;
}

const recipe = (id: string) => RECIPES.find((entry) => entry.id === id)!;
// A clean recipe (two templates, no code) and one with a bundled script.
const RECIPES_SHOWN = [recipe("meeting-notes"), recipe("book-finder"), recipe("kanban-task")];

function open() {
	const setTitle = vi.fn();
	const onImported = vi.fn();
	const view = render(RecipesModal, {
		props: { app: fakeApp(), recipes: RECIPES_SHOWN, setTitle, onImported },
	});
	const card = (id: string) => view.container.querySelector(`[data-recipe-id="${id}"]`) as HTMLElement;
	return { ...view, setTitle, onImported, card };
}

afterEach(() => {
	vi.mocked(applyPackageImport).mockClear();
	settingsStore.setState((state) => ({ ...state, choices: [], templateFolderPaths: [] }));
});

describe("Recipes gallery", () => {
	it("shows each recipe with what it adds and what it needs", () => {
		const { card } = open();
		expect(within(card("meeting-notes")).getByText("2 choices, 2 templates")).toBeTruthy();
		expect(within(card("book-finder")).getByText("1 choice, 1 script, 1 template")).toBeTruthy();
		expect(card("kanban-task").textContent).toContain(
			"Needs the Kanban community plugin and a board with at least one lane",
		);
		const guide = within(card("meeting-notes")).getByText("Guide") as HTMLAnchorElement;
		expect(guide.href).toBe("https://quickadd.obsidian.guide/docs/Examples/Template_MeetingNotes/");
	});

	it("narrows the list to the recipes the filter matches", async () => {
		const { container, getByLabelText } = open();
		await fireEvent.input(getByLabelText("Filter recipes"), { target: { value: "meeting" } });
		const ids = () => Array.from(container.querySelectorAll("[data-recipe-id]"), (el) => el.getAttribute("data-recipe-id"));
		expect(ids()).toEqual(["meeting-notes"]);
		await fireEvent.input(getByLabelText("Filter recipes"), { target: { value: "no such recipe" } });
		expect(ids()).toEqual([]);
		expect(container.textContent).toContain("No recipes match your filter.");
	});

	it("asks for the script acknowledgement before adding a recipe with a script", async () => {
		const { getAllByText, getByLabelText, getByRole, getByText, setTitle } = open();
		await fireEvent.click(getByLabelText(`Add ${recipe("book-finder").title}`));

		await waitFor(() => expect(getByText("What this recipe can do")).toBeTruthy());
		expect(getByText("Show sequence")).toBeTruthy();
		expect(setTitle).toHaveBeenLastCalledWith(recipe("book-finder").title);
		const checkbox = getByRole("checkbox") as HTMLInputElement;
		const addButton = getByText("Add recipe") as HTMLButtonElement;
		expect(checkbox.disabled).toBe(true);
		expect(addButton.disabled).toBe(true);
		expect(applyPackageImport).not.toHaveBeenCalled();

		// The script and its template each have contents; opening the script unlocks it.
		for (const button of getAllByText("View contents")) await fireEvent.click(button);
		await waitFor(() => expect(checkbox.disabled).toBe(false));
		await fireEvent.click(checkbox);
		await waitFor(() => expect(addButton.disabled).toBe(false));
	});

	it("adds a recipe with nothing to review in one click, and the card reads Added", async () => {
		const { card, getByLabelText, onImported } = open();
		await fireEvent.click(getByLabelText(`Add ${recipe("meeting-notes").title}`));

		await waitFor(() => expect(applyPackageImport).toHaveBeenCalledTimes(1));
		const options = vi.mocked(applyPackageImport).mock.calls[0][0];
		expect(options.pkg.rootChoiceIds).toEqual(recipe("meeting-notes").package.rootChoiceIds);
		expect(options.choiceDecisions.map((decision) => decision.mode)).toEqual(["import", "import"]);
		expect(options.assetDecisions).toEqual([
			{ originalPath: "Templates/Meeting.md", destinationPath: "Templates/Meeting.md", mode: "write" },
			{ originalPath: "Templates/Project update.md", destinationPath: "Templates/Project update.md", mode: "write" },
		]);
		expect(onImported).toHaveBeenCalledTimes(1);

		await waitFor(() => expect(within(card("meeting-notes")).getByText("Added")).toBeTruthy());
		const steps = Array.from(card("meeting-notes").querySelectorAll("li"), (li) => li.textContent);
		expect(steps).toHaveLength(2);
		expect(steps[0]).toContain("Run New meeting from the command palette");
	});

	it("sends a recipe whose choices already exist to the review", async () => {
		settingsStore.setState((state) => ({
			...state,
			choices: [{ id: "qa-pkg-meeting-notes", name: "New meeting", type: "Template", command: false } as never],
		}));
		const { getByLabelText, getByText } = open();
		await fireEvent.click(getByLabelText(`Add ${recipe("meeting-notes").title}`));

		const action = await waitFor(() => getByLabelText("Action for New meeting") as HTMLSelectElement);
		expect(action.value).toBe("overwrite");
		expect(getByText("Add recipe")).toBeTruthy();
		expect(applyPackageImport).not.toHaveBeenCalled();
	});
});
