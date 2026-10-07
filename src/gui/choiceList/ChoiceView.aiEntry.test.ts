// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";

import { App } from "obsidian";
import { render } from "@testing-library/svelte";
import ChoiceView from "./ChoiceView.svelte";
import { settingsStore } from "../../settingsStore";
import type QuickAdd from "../../main";
import type IChoice from "../../types/choices/IChoice";

// Before this, the AI Assistant button lived only in the bottom bar, which the
// empty state does not render: a new vault had no way into AI settings.
describe("ChoiceView AI Assistant entry point", () => {
	const initialState = settingsStore.getState();

	afterEach(() => {
		settingsStore.setState(initialState, true);
	});

	function renderView(choices: IChoice[], openAISettings = vi.fn()) {
		settingsStore.setState({ choices });
		return render(ChoiceView, {
			props: {
				app: new App() as never,
				plugin: {} as unknown as QuickAdd,
				choices,
				saveChoices: vi.fn(),
				openAISettings,
			},
		});
	}
	const renderEmpty = () => renderView([]);

	it("offers AI settings in the empty state when online features are on", () => {
		settingsStore.setState({ disableOnlineFeatures: false });
		const openAISettings = vi.fn();
		const { getByRole } = renderView([], openAISettings);

		getByRole("button", { name: "Configure AI Assistant" }).click();

		// The settings tab opens its AI Assistant page; no modal of its own.
		expect(openAISettings).toHaveBeenCalledTimes(1);
		expect(document.querySelector(".modal")).toBeNull();
	});

	it("opens the same page from the sparkles button once choices exist", () => {
		settingsStore.setState({ disableOnlineFeatures: false });
		const openAISettings = vi.fn();
		const choice = {
			id: "c1",
			name: "Inbox",
			type: "Capture",
			command: false,
		} as unknown as IChoice;
		const { getByRole } = renderView([choice], openAISettings);

		getByRole("button", { name: "Configure AI Assistant" }).click();

		expect(openAISettings).toHaveBeenCalledTimes(1);
	});

	it("hides it while AI and online features are disabled", () => {
		settingsStore.setState({ disableOnlineFeatures: true });
		const { queryByRole } = renderEmpty();

		expect(queryByRole("button", { name: "Configure AI Assistant" })).toBeNull();
	});
});
