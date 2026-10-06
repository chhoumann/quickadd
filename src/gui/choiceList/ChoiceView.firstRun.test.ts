import { App } from "obsidian";
import { fireEvent, render } from "@testing-library/svelte";
import { describe, expect, it, vi } from "vitest";
import type QuickAdd from "../../main";
import type IChoice from "../../types/choices/IChoice";
import type { Plain } from "../svelte/persist.svelte";
import ChoiceView from "./ChoiceView.svelte";
import type * as firstRun from "./firstRun";
import { planFirstRun } from "./firstRun";

const recipesOpened = vi.hoisted(() => vi.fn());
vi.mock("../recipes/RecipesModal", () => ({
	RecipesModal: class {
		open = recipesOpened;
	},
}));

vi.mock("./firstRun", async (importOriginal) => {
	const actual = await importOriginal<typeof firstRun>();
	return { ...actual, planFirstRun: vi.fn(actual.planFirstRun) };
});

function renderEmpty(existing: string[] = [], choices: IChoice[] = []) {
	const created: string[] = [];
	const create = vi.fn(async (path: string, _content: string) => void created.push(path));
	const app = new App();
	Object.assign(app.vault, {
		adapter: { exists: async (path: string) => existing.includes(path) || created.includes(path) },
		createFolder: async (path: string) => void created.push(path),
		create,
	});
	const saveChoices = vi.fn<(next: Plain<IChoice[]>) => void>();
	const view = render(ChoiceView, {
		props: { app, plugin: {} as QuickAdd, choices, saveChoices, openAISettings: () => {} },
	});
	const card = (title: string) => view.getByRole("button", { name: new RegExp(`^${title}`) });
	return { ...view, create, saveChoices, card };
}

describe("the empty list's first run", () => {
	it("picks jobs by clicking their cards, and counts the choices on the Create button", async () => {
		const { getByRole, card } = renderEmpty();
		const create = () => getByRole("button", { name: /^Create/ });

		expect(getByRole("heading", { name: "What do you do in Obsidian?" })).toBeInTheDocument();
		expect(create()).toHaveTextContent("Create choices");
		expect(create()).toBeDisabled();

		await fireEvent.click(card("Keep a daily journal"));
		expect(card("Keep a daily journal")).toHaveAttribute("aria-pressed", "true");
		expect(create()).toHaveTextContent("Create 2 choices");
		expect(create()).toBeEnabled();

		await fireEvent.click(card("Track tasks"));
		expect(create()).toHaveTextContent("Create 3 choices");

		await fireEvent.click(card("Keep a daily journal"));
		expect(card("Keep a daily journal")).toHaveAttribute("aria-pressed", "false");
		expect(create()).toHaveTextContent("Create 1 choice");
	});

	it("offers the recipes under Create, which stays the one call to action", async () => {
		const { container, getByRole } = renderEmpty();
		expect(Array.from(container.querySelectorAll(".mod-cta"), (el) => el.textContent?.trim())).toEqual(["Create choices"]);

		await fireEvent.click(getByRole("button", { name: "or browse recipes" }));
		expect(recipesOpened).toHaveBeenCalledTimes(1);
	});

	it("says on each card what it adds, from what the vault has", () => {
		const { card } = renderEmpty();

		// The test vault has no daily notes and no templates.
		expect(card("Keep a daily journal")).toHaveTextContent("Log and Thought, in Journal/");
		expect(card("Meeting and people notes")).toHaveTextContent("Adds a Meeting template");
	});

	it("creates the picked jobs' choices, in card order, and the files they need, saved once", async () => {
		const { getByRole, card, create, saveChoices, container } = renderEmpty(["Templates/Project.md"]);

		await fireEvent.click(card("Run projects"));
		await fireEvent.click(card("Meeting and people notes"));
		await fireEvent.click(card("Keep a daily journal"));
		await fireEvent.click(getByRole("button", { name: "Create 4 choices" }));

		await vi.waitFor(() => expect(saveChoices).toHaveBeenCalledTimes(1));
		expect(vi.mocked(planFirstRun).mock.lastCall?.[0]).toEqual(["journal", "meetings", "projects"]);
		const saved = saveChoices.mock.calls[0][0] as unknown as Array<{ name: string; icon: string }>;
		expect(saved.map(({ name, icon }) => `${name} (${icon})`)).toEqual([
			"Log (clock)",
			"Thought (lightbulb)",
			"Meeting note (users)",
			"Project (folder-kanban)",
		]);
		// The Project template is already there, so only the Meeting one is written.
		expect(create).toHaveBeenCalledTimes(1);
		expect(create).toHaveBeenCalledWith("Templates/Meeting.md", expect.stringContaining("# Meeting with"));
		await vi.waitFor(() => expect(container.querySelector(".qaFirstRun")).toBeNull());
	});

	it("asks only while the list is empty", () => {
		const { queryByRole } = renderEmpty([], [{ id: "a", name: "A", type: "Capture" } as IChoice]);

		expect(queryByRole("heading", { name: "What do you do in Obsidian?" })).toBeNull();
	});
});
