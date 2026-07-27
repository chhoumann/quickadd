import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("obsidian-dataview", () => ({ getAPI: vi.fn() }));
vi.mock("../choiceRename", () => ({
	promptRenameChoice: vi.fn().mockResolvedValue(undefined),
}));

import { App } from "obsidian";
import { fireEvent, render } from "@testing-library/svelte";
import ChoiceView from "./ChoiceView.svelte";
import { log } from "../../logger/logManager";
import type QuickAdd from "../../main";
import type IChoice from "../../types/choices/IChoice";
import type { Plain } from "../svelte/persist.svelte";

/**
 * #1585. The row actions are `async` handlers with no `catch`. Svelte re-throws an
 * event handler's error to the window and a rejected promise is an unhandled
 * rejection, so a failing action produced NOTHING: no Notice, no visual change,
 * no message the user would ever think to look for. The button just did not work.
 *
 * The fixture is the shape that reproduces it live: a choice whose `type` is not a
 * known choice type (a hand-edit, or an import from a newer QuickAdd). Configure
 * routes to `getChoiceBuilder`, which throws "Invalid choice type".
 */
const choiceWithUnknownType = (): IChoice =>
	({
		id: "bogus-type",
		name: "Choice with a bad type",
		type: "Templat",
		command: false,
	}) as unknown as IChoice;

const renderChoiceView = (choices: IChoice[]) =>
	render(ChoiceView, {
		props: {
			app: new App() as never,
			plugin: {} as unknown as QuickAdd,
			choices,
			saveChoices: vi.fn<(next: Plain<IChoice[]>) => void>(),
		},
	});

describe("ChoiceView row actions that fail (#1585)", () => {
	afterEach(() => {
		vi.restoreAllMocks();
	});

	it("reports the failure through the plugin's own error channel", async () => {
		const logError = vi.spyOn(log, "logError").mockImplementation(() => {});
		const { getByLabelText } = renderChoiceView([choiceWithUnknownType()]);

		await fireEvent.click(getByLabelText("Configure Choice with a bad type"));

		await vi.waitFor(() => expect(logError).toHaveBeenCalled());
		// GuiLogger turns exactly this into the Notice the user sees.
		expect((logError.mock.calls[0][0] as Error).message).toBe(
			"Couldn't open the settings for the choice “Choice with a bad type”: Invalid choice type",
		);
	});

	// #1552's vocabulary rule reaches the error copy too: "Multi" is the internal
	// type id for what every user-facing surface calls a folder. Duplicating a
	// folder recurses into its children, so a bad child makes the FOLDER's row
	// action fail - and the message has to name a folder, not a choice.
	it("calls a folder a folder", async () => {
		const logError = vi.spyOn(log, "logError").mockImplementation(() => {});
		const folder = {
			id: "folder",
			name: "My folder",
			type: "Multi",
			command: false,
			collapsed: false,
			choices: [choiceWithUnknownType()],
		} as unknown as IChoice;
		const { getByLabelText } = renderChoiceView([folder]);

		await fireEvent.click(getByLabelText("Duplicate My folder"));

		await vi.waitFor(() => expect(logError).toHaveBeenCalled());
		expect((logError.mock.calls[0][0] as Error).message).toBe(
			"Couldn't duplicate the folder “My folder”: Unknown choice type: Templat",
		);
	});

	it("keeps the rest of the list alive after the failure", async () => {
		vi.spyOn(log, "logError").mockImplementation(() => {});
		const healthy = {
			id: "ok",
			name: "Healthy template",
			type: "Template",
			command: false,
		} as unknown as IChoice;
		const { getByLabelText } = renderChoiceView([
			choiceWithUnknownType(),
			healthy,
		]);

		await fireEvent.click(getByLabelText("Configure Choice with a bad type"));

		expect(getByLabelText("Configure Healthy template")).toBeInTheDocument();
		expect(getByLabelText("New choice")).toBeInTheDocument();
	});
});
