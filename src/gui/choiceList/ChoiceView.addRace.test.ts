import { describe, expect, it, vi, afterEach } from "vitest";

vi.mock("obsidian-dataview", () => ({ getAPI: vi.fn() }));

// The builder modal, held open: the deferred stands in for the user configuring
// the brand-new choice while the rest of the app keeps running.
const { configureChoiceMock } = vi.hoisted(() => ({
	configureChoiceMock: vi.fn(),
}));
vi.mock("../../services/choiceService", async (importOriginal) => ({
	...(await importOriginal<typeof ChoiceServiceModule>()),
	configureChoice: configureChoiceMock,
}));

import { App, Menu } from "obsidian";
import type * as ChoiceServiceModule from "../../services/choiceService";

// The vitest obsidian stub records the last Menu shown so menu-driven flows can
// be driven without a real DOM menu; the real typings know nothing about it.
type MenuStubItem = {
	title: string;
	clickHandler: ((evt: MouseEvent) => void) | null;
};
const MenuStub = Menu as unknown as {
	lastShown: { items: MenuStubItem[] } | null;
};
import { fireEvent, render } from "@testing-library/svelte";
import ChoiceView from "./ChoiceView.svelte";
import { settingsStore } from "../../settingsStore";
import type QuickAdd from "../../main";
import type IChoice from "../../types/choices/IChoice";
import type { Plain } from "../svelte/persist.svelte";

/**
 * Regression for #1625: a new doer choice used to exist ONLY in ChoiceView's
 * local tree while its builder was open (no eager save). The view re-seeds that
 * tree from the settings store on EVERY store write - and writes land on their
 * own schedule (model auto-sync ~seconds after launch, migrations) - so any
 * write during the builder session wiped the new choice, and the builder's
 * save-by-id then persisted a tree without it. Data loss on the happy path.
 */
describe("ChoiceView new-choice race (#1625)", () => {
	const initialState = settingsStore.getState();

	afterEach(() => {
		settingsStore.setState(initialState, true);
		configureChoiceMock.mockReset();
		MenuStub.lastShown = null;
	});

	it("keeps a new choice when a settings write lands while its builder is open", async () => {
		settingsStore.setState({ choices: [] });

		// Production wiring: saveChoices persists into the settings store, whose
		// subscription then re-seeds the view (quickAddSettingsTab.renderChoicesView).
		const saveChoices = vi.fn((next: Plain<IChoice[]>) => {
			settingsStore.setState({ choices: next as IChoice[] });
		});

		let finishConfigure: (choice: IChoice) => void = () => {};
		configureChoiceMock.mockImplementation(
			(choice: IChoice) =>
				new Promise<IChoice>((resolve) => {
					finishConfigure = (configured) =>
						resolve({ ...choice, ...configured });
				}),
		);

		const { getByLabelText } = render(ChoiceView, {
			props: {
				app: new App() as never,
				plugin: {} as unknown as QuickAdd,
				choices: settingsStore.getState().choices,
				saveChoices,
			},
		});

		// Add a Template choice through the real menu -> addChoiceToList path.
		await fireEvent.click(getByLabelText("New choice"));
		const templateItem = MenuStub.lastShown?.items.find((item) =>
			item.title.includes("Template"),
		);
		expect(templateItem?.clickHandler).toBeTruthy();
		// The real handler reads altKey off the click event (Alt = scaffold only).
		templateItem?.clickHandler?.(new MouseEvent("click"));
		await vi.waitFor(() => expect(configureChoiceMock).toHaveBeenCalled());

		// While the builder is open, an UNRELATED settings write lands (the shape
		// modelSyncService produces a few seconds after launch).
		settingsStore.setState({ disableOnlineFeatures: true });

		// The builder closes with the configured choice.
		finishConfigure({ name: "Configured template" } as IChoice);

		await vi.waitFor(() => {
			const persisted = settingsStore.getState().choices;
			expect(persisted.map((c) => c.name)).toContain("Configured template");
		});
	});
});
