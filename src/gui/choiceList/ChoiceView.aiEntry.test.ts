import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("obsidian-dataview", () => ({ getAPI: vi.fn() }));

import { App } from "obsidian";
import { render } from "@testing-library/svelte";
import ChoiceView from "./ChoiceView.svelte";
import { settingsStore } from "../../settingsStore";
import type QuickAdd from "../../main";

// Before this, the AI Assistant button lived only in the bottom bar, which the
// empty state does not render: a new vault had no way into AI settings.
describe("ChoiceView AI Assistant entry point", () => {
	const initialState = settingsStore.getState();

	afterEach(() => {
		settingsStore.setState(initialState, true);
	});

	function renderEmpty() {
		settingsStore.setState({ choices: [] });
		return render(ChoiceView, {
			props: {
				app: new App() as never,
				plugin: {} as unknown as QuickAdd,
				choices: [],
				saveChoices: vi.fn(),
			},
		});
	}

	it("offers AI settings in the empty state when online features are on", () => {
		settingsStore.setState({ disableOnlineFeatures: false });
		const { getByRole } = renderEmpty();

		expect(getByRole("button", { name: "Configure AI Assistant" })).toBeTruthy();
	});

	it("hides it while AI and online features are disabled", () => {
		settingsStore.setState({ disableOnlineFeatures: true });
		const { queryByRole } = renderEmpty();

		expect(queryByRole("button", { name: "Configure AI Assistant" })).toBeNull();
	});
});
