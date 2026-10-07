// @vitest-environment jsdom
import { describe, expect, it, vi, afterEach } from "vitest";

vi.mock("obsidian-dataview", () => ({ getAPI: vi.fn() }));

// The rename prompt, held open while settings synced from another device land.
const { promptRenameChoiceMock } = vi.hoisted(() => ({
	promptRenameChoiceMock: vi.fn(),
}));
vi.mock("../choiceRename", () => ({ promptRenameChoice: promptRenameChoiceMock }));

import { App, Menu, Notice, type SettingPage } from "obsidian";
import { fireEvent, render } from "@testing-library/svelte";
import ChoiceView from "./ChoiceView.svelte";
import { settingsStore } from "../../settingsStore";
import type QuickAdd from "../../main";
import type IChoice from "../../types/choices/IChoice";
import type { Plain } from "../svelte/persist.svelte";
import type { BuilderPage } from "../ChoiceBuilder/builderPage";
import { CaptureChoice } from "../../types/choices/CaptureChoice";

type CaptureLike = IChoice & { captureTo: string; activeFileWritePosition?: string };

// A full Capture choice, so the builder's form mounts, saved before
// activeFileWritePosition existed: the builder fills it in as it opens.
const inbox: CaptureLike = {
	...JSON.parse(JSON.stringify(new CaptureChoice("Inbox"))),
	id: "inbox",
	captureTo: "Inbox.md",
};
delete inbox.activeFileWritePosition;
const journal: CaptureLike = { ...inbox, id: "journal", name: "Journal", captureTo: "Journal.md" };

const notices = () =>
	(Notice as unknown as { instances: Array<{ message: string }> }).instances.map(
		(notice) => notice.message,
	);
const DELETED = "QuickAdd: “Inbox” was deleted elsewhere, so your changes to it were not saved.";

function renderChoiceView() {
	const plugin = {
		addCommandForChoice: vi.fn(),
		removeCommandForChoice: vi.fn(),
		getTemplateFiles: () => [],
		settings: { choices: [] },
	};
	// Obsidian's settings window: opening a page displays it.
	let page: BuilderPage<IChoice> | undefined;
	const app = new App() as App & { setting: { openPage: (opened: SettingPage) => void } };
	app.setting = {
		openPage: (opened) => {
			page = opened as BuilderPage<IChoice>;
			opened.display();
		},
	};
	const { getByLabelText } = render(ChoiceView, {
		props: {
			app: app as never,
			plugin: plugin as unknown as QuickAdd,
			choices: settingsStore.getState().choices,
			// Production wiring: the view saves into the settings store.
			saveChoices: (next: Plain<IChoice[]>) => {
				settingsStore.setState({ choices: next as IChoice[] });
			},
			openAISettings: vi.fn(),
		},
	});
	return { getByLabelText, plugin, page: () => page };
}

/** Open the builder page for `name` and return it with its Name field. */
async function openBuilderOn(name: string) {
	const view = renderChoiceView();
	await fireEvent.click(view.getByLabelText(`Configure ${name}`));
	const page = view.page();
	if (!page) throw new Error("No builder page opened");
	const nameField = page.containerEl.querySelector<HTMLInputElement>("input");
	if (!nameField) throw new Error("Missing Name field");
	const rename = (value: string) => fireEvent.input(nameField, { target: { value } });
	return { page, rename, plugin: view.plugin };
}

const stored = (id: string) =>
	settingsStore.getState().choices.find((choice) => choice.id === id) as CaptureLike | undefined;

describe("ChoiceView builder and settings synced from elsewhere (#2003)", () => {
	const initialState = settingsStore.getState();

	afterEach(() => {
		settingsStore.setState(initialState, true);
		promptRenameChoiceMock.mockReset();
		(Notice as unknown as { instances: unknown[] }).instances.length = 0;
	});

	it("keeps another device's edit to the same choice when its builder is left", async () => {
		settingsStore.setState({ choices: [inbox, journal] });
		const { page, rename } = await openBuilderOn("Inbox");

		// While the builder is open, the other device changes the capture target,
		// sets the field the builder backfilled, and changes the other choice.
		settingsStore.setState({
			choices: [
				{ ...inbox, captureTo: "Phone.md", activeFileWritePosition: "top" } as IChoice,
				{ ...journal, captureTo: "Daily.md" } as IChoice,
			],
		});
		// Here, only the name was edited.
		await rename("Inbox (here)");
		expect(page.containerEl.querySelector(".qaMountFailed")).toBeNull();
		page.hide();

		expect(stored("inbox")).toMatchObject({
			name: "Inbox (here)",
			captureTo: "Phone.md",
			activeFileWritePosition: "top",
		});
		expect(stored("journal")).toMatchObject({ captureTo: "Daily.md" });
	});

	it("saves in place when the app goes to the background, and again when left", async () => {
		settingsStore.setState({ choices: [inbox, journal] });
		const { page, rename } = await openBuilderOn("Inbox");

		await rename("Checkpoint");
		page.save();
		expect(stored("inbox")?.name).toBe("Checkpoint");

		// After the checkpoint another device edits the choice, and here the
		// name goes back to what it was: both land, and the revert is an edit.
		settingsStore.setState({
			choices: [{ ...stored("inbox"), captureTo: "Phone.md" } as IChoice, journal],
		});
		await rename("Inbox");
		page.hide();

		expect(stored("inbox")).toMatchObject({ name: "Inbox", captureTo: "Phone.md" });
		expect(notices()).not.toContain(DELETED);
	});

	it("says once that the choice was deleted elsewhere, and does not bring it back", async () => {
		settingsStore.setState({ choices: [inbox, journal] });
		const { page, rename } = await openBuilderOn("Inbox");
		await rename("Edited");

		settingsStore.setState({ choices: [journal] });
		page.save();
		page.save();
		page.hide();

		expect(notices().filter((message) => message === DELETED)).toHaveLength(1);
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
