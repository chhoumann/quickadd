import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render } from "@testing-library/svelte";
import { flushSync } from "svelte";
import { App } from "obsidian";
import GlobalVariablesView from "./GlobalVariablesView.svelte";
import { settingsStore } from "../../settingsStore";
import { DEFAULT_SETTINGS } from "../../settings";
import { deepClone } from "../../utils/deepClone";

// Regression coverage for the Global Variables mid-edit data-loss footgun:
// persistToSettings drops empty-name rows and the store subscriber reloaded
// `items` on EVERY store change — including the component's own debounced
// persist. Clearing a Name field (to retype it) therefore made the row, and
// the snippet value the user wrote, vanish. The fix suppresses the reload that
// the component's own setState triggers, so in-memory rows survive editing.

function appWithSuggestSupport(): App {
	const app = new App() as App & {
		dom: { appContainerEl: HTMLElement };
		keymap: { pushScope: () => void; popScope: () => void };
	};
	app.dom = { appContainerEl: document.body };
	app.keymap = { pushScope: vi.fn(), popScope: vi.fn() };
	return app;
}

function fakePlugin() {
	return {
		settings: { choices: [] },
		getTemplateFiles: () => [],
	} as never;
}

function getNameInputs(container: HTMLElement): HTMLInputElement[] {
	return Array.from(
		container.querySelectorAll<HTMLInputElement>(".qa-gv__name input"),
	);
}

function getValueTextareas(container: HTMLElement): HTMLTextAreaElement[] {
	return Array.from(
		container.querySelectorAll<HTMLTextAreaElement>(".qa-gv__value textarea"),
	);
}

describe("GlobalVariablesView mid-edit persistence (audit)", () => {
	beforeEach(() => {
		vi.useFakeTimers();
		settingsStore.replaceState(deepClone(DEFAULT_SETTINGS));
	});

	afterEach(() => {
		vi.runOnlyPendingTimers();
		vi.useRealTimers();
		settingsStore.replaceState(deepClone(DEFAULT_SETTINGS));
	});

	it("keeps the row and its value when the Name field is cleared mid-edit", async () => {
		settingsStore.setState({ globalVariables: { foo: "snippet-data" } });

		const { container } = render(GlobalVariablesView, {
			props: { app: appWithSuggestSupport(), plugin: fakePlugin() },
		});

		expect(getNameInputs(container)).toHaveLength(1);
		expect(getValueTextareas(container)[0].value).toBe("snippet-data");

		// User selects-all + deletes the Name to retype it.
		const nameInput = getNameInputs(container)[0];
		nameInput.value = "";
		await fireEvent.input(nameInput);

		// Pause past the 200ms debounce -> persistToSettings runs and writes an
		// empty record (empty name is unkeyable). Pre-fix the subscriber reloaded
		// items to [] and the row + value disappeared.
		vi.advanceTimersByTime(250);
		flushSync();

		const valueTextareas = getValueTextareas(container);
		expect(valueTextareas).toHaveLength(1);
		expect(valueTextareas[0].value).toBe("snippet-data");
		// And the store is NOT corrupted with a lossy record: an empty (unkeyable)
		// name is never written, so the previously-persisted value is preserved
		// until the name is valid again (Codex review follow-up).
		expect(settingsStore.getState().globalVariables).toEqual({
			foo: "snippet-data",
		});
	});

	it("does not collapse a second row when its name transiently duplicates another", async () => {
		settingsStore.setState({
			globalVariables: { foo: "first-value", bar: "second-value" },
		});

		const { container } = render(GlobalVariablesView, {
			props: { app: appWithSuggestSupport(), plugin: fakePlugin() },
		});

		expect(getNameInputs(container)).toHaveLength(2);

		// User renames the second row to collide with the first.
		const secondName = getNameInputs(container)[1];
		secondName.value = "foo";
		await fireEvent.input(secondName);
		vi.advanceTimersByTime(250);
		flushSync();

		// Both rows (and their values) remain on screen mid-edit; the snippet the
		// user wrote into the second row is not silently destroyed.
		const valueTextareas = getValueTextareas(container);
		expect(valueTextareas).toHaveLength(2);
		expect(valueTextareas.map((t) => t.value)).toContain("second-value");
		// The duplicate name is never persisted (no last-wins collapse): the
		// store keeps the prior valid record until the names are unique again.
		expect(settingsStore.getState().globalVariables).toEqual({
			foo: "first-value",
			bar: "second-value",
		});
	});
});
