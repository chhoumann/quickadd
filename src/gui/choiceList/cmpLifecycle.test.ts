import { describe, expect, it, vi } from "vitest";

import { App, Component, Menu } from "obsidian";
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
	onAddChoice: vi.fn(),
	onAddFolder: vi.fn(),
	onToggleCollapsed: vi.fn(),
	onCommitFolder: vi.fn(),
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

describe("choice row context menu", () => {
	const nested = { id: "a", name: "Alpha", type: "Template", command: false } as unknown as IChoice;
	const folder = {
		id: "g", name: "Group", type: "Multi", command: false, collapsed: true, choices: [nested],
	} as unknown as IMultiChoice;
	const target = { id: "t", name: "Target", type: "Multi", command: false, choices: [] } as unknown as IMultiChoice;
	const roots = [folder, target];

	it.each([
		["ChoiceListItem", ".choiceListItem", nested],
		["MultiChoiceListItem", ".multiChoiceListItem", folder],
	] as const)("%s routes each menu item to the list action with its choice", (_name, selector, choice) => {
		const list = actions();
		const Row = (choice === folder ? MultiChoiceListItem : ChoiceListItem) as typeof ChoiceListItem;
		const { container } = render(Row, {
			props: { choice, app: new App() as never, roots, collapseId: "", dragDisabled: true, startDrag: noop, actions: list } as never,
		});
		container.querySelector(selector)!.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true }));
		const items = (Menu as unknown as { lastShown: { items: { title: string; clickHandler: (() => void) | null }[] } }).lastShown.items;
		const click = (title: string) => items.find((item) => item.title === title)!.clickHandler!();

		click("Rename");
		click("Configure");
		click("Duplicate");
		click("Delete");
		click("Enable in command palette");
		click("Move to: Target");

		expect(list.onRenameChoice).toHaveBeenCalledWith(choice);
		expect(list.onConfigureChoice).toHaveBeenCalledWith(choice);
		expect(list.onDuplicateChoice).toHaveBeenCalledWith(choice);
		expect(list.onDeleteChoice).toHaveBeenCalledWith(choice);
		expect(list.onToggleCommand).toHaveBeenCalledWith(choice);
		expect(list.onMoveChoice).toHaveBeenCalledWith(choice, "t");
	});
});
