import { describe, expect, it, vi, afterEach } from "vitest";

vi.mock("obsidian-dataview", () => ({ getAPI: vi.fn() }));

// The builder and rename prompt, held open while settings synced from another
// device land.
const { configureChoiceMock, promptRenameChoiceMock } = vi.hoisted(() => ({
	configureChoiceMock: vi.fn(),
	promptRenameChoiceMock: vi.fn(),
}));
vi.mock("../../services/choiceService", async (importOriginal) => ({
	...(await importOriginal<typeof ChoiceServiceModule>()),
	configureChoice: configureChoiceMock,
}));
vi.mock("../choiceRename", () => ({ promptRenameChoice: promptRenameChoiceMock }));

import { App, Menu, Notice } from "obsidian";
import type * as ChoiceServiceModule from "../../services/choiceService";
import { fireEvent, render } from "@testing-library/svelte";
import ChoiceView from "./ChoiceView.svelte";
import { settingsStore } from "../../settingsStore";
import type QuickAdd from "../../main";
import type IChoice from "../../types/choices/IChoice";
import type { Plain } from "../svelte/persist.svelte";

type CaptureLike = IChoice & { captureTo: string };

const inbox: CaptureLike = {
	id: "inbox",
	name: "Inbox",
	type: "Capture",
	command: false,
	captureTo: "Inbox.md",
};
const journal: CaptureLike = { ...inbox, id: "journal", name: "Journal", captureTo: "Journal.md" };

function renderChoiceView() {
	const plugin = { addCommandForChoice: vi.fn(), removeCommandForChoice: vi.fn() };
	const { getByLabelText } = render(ChoiceView, {
		props: {
			app: new App() as never,
			plugin: plugin as unknown as QuickAdd,
			choices: settingsStore.getState().choices,
			// Production wiring: the view saves into the settings store.
			saveChoices: (next: Plain<IChoice[]>) => {
				settingsStore.setState({ choices: next as IChoice[] });
			},
			openAISettings: vi.fn(),
		},
	});
	return { getByLabelText, plugin };
}

function openBuilderOn(name: string): (edit: Partial<CaptureLike>) => void {
	let finish: (choice: IChoice) => void = () => {};
	let opened: IChoice | undefined;
	configureChoiceMock.mockImplementation((choice: IChoice & { openInNewTab?: boolean }) => {
		// Like the real builders: backfill a missing default on the choice
		// itself, synchronously, as the builder opens.
		choice.openInNewTab ??= false;
		opened = JSON.parse(JSON.stringify(choice)) as IChoice;
		return new Promise<IChoice>((resolve) => {
			finish = resolve;
		});
	});

	const { getByLabelText } = renderChoiceView();
	void fireEvent.click(getByLabelText(`Configure ${name}`));
	return (edit) => finish({ ...(opened as IChoice), ...edit } as IChoice);
}

describe("ChoiceView builder and settings synced from elsewhere (#2003)", () => {
	const initialState = settingsStore.getState();

	afterEach(() => {
		settingsStore.setState(initialState, true);
		configureChoiceMock.mockReset();
		promptRenameChoiceMock.mockReset();
		(Notice as unknown as { instances: unknown[] }).instances.length = 0;
	});

	it("keeps another device's edit to the same choice when its builder closes", async () => {
		settingsStore.setState({ choices: [inbox, journal] });
		const closeBuilder = openBuilderOn("Inbox");
		await vi.waitFor(() => expect(configureChoiceMock).toHaveBeenCalled());

		// While the builder is open, the other device renames this choice, sets
		// the field the builder backfilled, and changes the other choice.
		settingsStore.setState({
			choices: [
				{ ...inbox, name: "Inbox (phone)", openInNewTab: true } as IChoice,
				{ ...journal, captureTo: "Daily.md" } as IChoice,
			],
		});
		// Here, only the capture target was edited.
		closeBuilder({ captureTo: "Later.md" });

		await vi.waitFor(() =>
			expect(settingsStore.getState().choices).toEqual([
				{ ...inbox, name: "Inbox (phone)", openInNewTab: true, captureTo: "Later.md" },
				{ ...journal, captureTo: "Daily.md" },
			]),
		);
	});

	it("says so instead of saving when the choice was deleted elsewhere", async () => {
		settingsStore.setState({ choices: [inbox, journal] });
		const closeBuilder = openBuilderOn("Inbox");
		await vi.waitFor(() => expect(configureChoiceMock).toHaveBeenCalled());

		settingsStore.setState({ choices: [journal] });
		closeBuilder({ captureTo: "Later.md" });

		const notices = (Notice as unknown as { instances: Array<{ message: string }> }).instances;
		await vi.waitFor(() =>
			expect(notices.map((notice) => notice.message)).toContain(
				"QuickAdd: “Inbox” was deleted elsewhere, so your changes to it were not saved.",
			),
		);
		expect(settingsStore.getState().choices).toEqual([journal]);
	});

	it("registers no command when a choice is renamed after it was deleted elsewhere", async () => {
		settingsStore.setState({ choices: [{ ...inbox, command: true }, journal] });
		let submitRename: (name: string) => void = () => {};
		promptRenameChoiceMock.mockImplementation(
			() => new Promise<string>((resolve) => { submitRename = resolve; }),
		);
		const { getByLabelText, plugin } = renderChoiceView();
		await fireEvent.click(getByLabelText("More options for Inbox"));
		(Menu as unknown as { lastShown: Menu & { items: Array<{ title: string; clickHandler: () => void }> } })
			.lastShown.items.find((item) => item.title === "Rename")?.clickHandler();
		await vi.waitFor(() => expect(promptRenameChoiceMock).toHaveBeenCalled());

		settingsStore.setState({ choices: [journal] });
		submitRename("Renamed");

		const notices = (Notice as unknown as { instances: Array<{ message: string }> }).instances;
		await vi.waitFor(() =>
			expect(notices.map((notice) => notice.message)).toContain(
				"QuickAdd: “Inbox” was deleted elsewhere, so it was not renamed.",
			),
		);
		expect(plugin.addCommandForChoice).not.toHaveBeenCalled();
		expect(settingsStore.getState().choices).toEqual([journal]);
	});
});
