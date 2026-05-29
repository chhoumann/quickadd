import { describe, expect, it, vi } from "vitest";

vi.mock("obsidian-dataview", () => ({ getAPI: vi.fn() }));

import { App, Component } from "obsidian";
import { render } from "@testing-library/svelte";
import { flushSync } from "svelte";
import ChoiceListItem from "./ChoiceListItem.svelte";
import MultiChoiceListItem from "./MultiChoiceListItem.svelte";
import type IChoice from "../../types/choices/IChoice";
import type IMultiChoice from "../../types/choices/IMultiChoice";
import type { ChoiceListActions } from "./choiceListActions";

const actions = (): ChoiceListActions => ({
	onDeleteChoice: vi.fn(),
	onConfigureChoice: vi.fn(),
	onToggleCommand: vi.fn(),
	onDuplicateChoice: vi.fn(),
	onRenameChoice: vi.fn(),
	onMoveChoice: vi.fn(),
	onReorderChoices: vi.fn(),
});
const noop = () => {};

describe("choice row markdown-Component lifecycle", () => {
	it("ChoiceListItem unloads its render Component on destroy", () => {
		const spy = vi.spyOn(Component.prototype, "unload");
		const before = spy.mock.calls.length;
		const choice = { id: "a", name: "Alpha", type: "Template", command: false } as unknown as IChoice;

		const { unmount } = render(ChoiceListItem, {
			props: { choice, app: new App() as never, roots: [choice], dragDisabled: true, startDrag: noop, actions: actions() },
		});
		unmount();
		flushSync();

		expect(spy.mock.calls.length).toBeGreaterThan(before);
		spy.mockRestore();
	});

	it("MultiChoiceListItem unloads its render Component on destroy", () => {
		const spy = vi.spyOn(Component.prototype, "unload");
		const before = spy.mock.calls.length;
		const choice = {
			id: "g", name: "Group", type: "Multi", command: false, collapsed: true, choices: [],
		} as unknown as IMultiChoice;

		const { unmount } = render(MultiChoiceListItem, {
			props: { choice, roots: [choice], collapseId: "", dragDisabled: true, startDrag: noop, app: new App() as never, actions: actions() },
		});
		unmount();
		flushSync();

		expect(spy.mock.calls.length).toBeGreaterThan(before);
		spy.mockRestore();
	});
});
