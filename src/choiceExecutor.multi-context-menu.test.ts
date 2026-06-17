import { beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "obsidian";
import type QuickAdd from "./main";
import type IChoice from "./types/choices/IChoice";
import type IMultiChoice from "./types/choices/IMultiChoice";
import { DEFAULT_SETTINGS } from "./settings";
import { settingsStore } from "./settingsStore";
import { deepClone } from "./utils/deepClone";

vi.mock("obsidian-dataview", () => ({ getAPI: vi.fn() }));

const choiceSuggesterOpen = vi.fn();
const openMultiChoiceContextMenu = vi.fn();

vi.mock("./gui/suggesters/choiceSuggester", () => ({
	default: {
		Open: choiceSuggesterOpen,
	},
}));

vi.mock("./gui/suggesters/choiceContextMenu", () => ({
	openMultiChoiceContextMenu,
}));

const { ChoiceExecutor } = await import("./choiceExecutor");

function makePlugin(): QuickAdd {
	const app = new App();
	return {
		app,
		settings: deepClone(DEFAULT_SETTINGS),
	} as unknown as QuickAdd;
}

function childChoice(): IChoice {
	return {
		id: "child",
		name: "Child",
		type: "Template",
		command: false,
	} as IChoice;
}

function multiChoice(overrides: Partial<IMultiChoice> = {}): IMultiChoice {
	return {
		id: "multi",
		name: "Multi",
		type: "Multi",
		command: false,
		collapsed: false,
		choices: [childChoice()],
		...overrides,
	};
}

beforeEach(() => {
	choiceSuggesterOpen.mockReset();
	openMultiChoiceContextMenu.mockReset();
	settingsStore.replaceState(deepClone(DEFAULT_SETTINGS));
});

describe("ChoiceExecutor Multi context-menu launch mode", () => {
	it("opens opt-in Multi choices through the context menu helper", async () => {
		const plugin = makePlugin();
		const executor = new ChoiceExecutor(plugin.app, plugin);
		const choice = multiChoice({ displayMode: "context-menu" });
		openMultiChoiceContextMenu.mockReturnValue(true);

		await executor.execute(choice);

		expect(openMultiChoiceContextMenu).toHaveBeenCalledWith(plugin, choice, {
			choiceExecutor: executor,
		});
		expect(choiceSuggesterOpen).not.toHaveBeenCalled();
	});

	it("falls back to the existing choice picker when context-menu positioning fails", async () => {
		const plugin = makePlugin();
		const executor = new ChoiceExecutor(plugin.app, plugin);
		const choice = multiChoice({
			displayMode: "context-menu",
			placeholder: "Pick a child",
		});
		openMultiChoiceContextMenu.mockReturnValue(false);

		await executor.execute(choice);

		expect(choiceSuggesterOpen).toHaveBeenCalledWith(plugin, choice.choices, {
			choiceExecutor: executor,
			placeholder: "Pick a child",
		});
	});

	it("keeps legacy Multi choices on the existing choice picker", async () => {
		const plugin = makePlugin();
		const executor = new ChoiceExecutor(plugin.app, plugin);
		const choice = multiChoice();

		await executor.execute(choice);

		expect(openMultiChoiceContextMenu).not.toHaveBeenCalled();
		expect(choiceSuggesterOpen).toHaveBeenCalledWith(plugin, choice.choices, {
			choiceExecutor: executor,
			placeholder: undefined,
		});
	});
});
