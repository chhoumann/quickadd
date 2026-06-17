import { beforeEach, describe, expect, it, vi } from "vitest";
import { App, Menu } from "obsidian";
import type { MarkdownView } from "obsidian";
import {
	collectChoicesForMenu,
	getEditorMenuPosition,
	showChoiceMenu,
} from "./choiceMenu";
import type IChoice from "../types/choices/IChoice";
import type IMultiChoice from "../types/choices/IMultiChoice";
import type { IChoiceExecutor } from "../IChoiceExecutor";

type RecordedMenu = Menu & {
	items: Array<{
		title: string;
		disabled: boolean;
		clickHandler: (() => void) | null;
	}>;
};

const getLastShownMenu = (): RecordedMenu | null =>
	(Menu as unknown as { lastShown: RecordedMenu | null }).lastShown;

const setLastShownMenu = (menu: RecordedMenu | null): void => {
	(Menu as unknown as { lastShown: RecordedMenu | null }).lastShown = menu;
};

const choice = (
	id: string,
	name: string,
	type: IChoice["type"] = "Template",
): IChoice => ({
	id,
	name,
	type,
	command: false,
});

const multi = (
	id: string,
	name: string,
	choices: IChoice[],
): IMultiChoice => ({
	id,
	name,
	type: "Multi",
	command: false,
	collapsed: false,
	choices,
});

describe("choice menu", () => {
	beforeEach(() => {
		setLastShownMenu(null);
	});

	it("flattens nested multis into path-labeled executable choices", () => {
		const choices = [
			multi("parent", "Formatting", [
				choice("bold", "Bold"),
				multi("case", "Case", [choice("upper", "Uppercase", "Macro")]),
			]),
		];

		expect(collectChoicesForMenu(choices)).toEqual([
			{ choice: choices[0].choices[0], title: "Formatting / Bold" },
			{
				choice: (choices[0].choices[1] as IMultiChoice).choices[0],
				title: "Formatting / Case / Uppercase",
			},
		]);
	});

	it("shows a disabled empty-state item when no executable choices exist", () => {
		const app = new App();
		const executor = { execute: vi.fn() } as unknown as IChoiceExecutor;

		showChoiceMenu(app, [multi("empty", "Empty", [])], executor);

		expect(getLastShownMenu()?.items).toHaveLength(1);
		expect(getLastShownMenu()?.items[0].title).toBe("No choices");
		expect(getLastShownMenu()?.items[0].disabled).toBe(true);
	});

	it("executes the selected leaf choice through the provided executor", () => {
		const app = new App();
		const leaf = choice("leaf", "Run me", "Capture");
		const executor = {
			execute: vi.fn().mockResolvedValue(undefined),
		} as unknown as IChoiceExecutor;

		showChoiceMenu(app, [leaf], executor);
		getLastShownMenu()?.items[0].clickHandler?.();

		expect(executor.execute).toHaveBeenCalledWith(leaf);
	});

	it("positions the menu inside the active editor when an editor container is available", () => {
		const app = new App();
		const view = {
			containerEl: document.createElement("div"),
		} as unknown as MarkdownView;
		const editorEl = view.containerEl.createDiv({ cls: "cm-editor" });
		vi.spyOn(editorEl, "getBoundingClientRect").mockReturnValue({
			left: 100,
			top: 200,
			width: 600,
			height: 300,
			right: 700,
			bottom: 500,
			x: 100,
			y: 200,
			toJSON: () => ({}),
		} as DOMRect);
		app.workspace.getActiveViewOfType = () => view as never;

		expect(getEditorMenuPosition(app)).toEqual({ x: 310, y: 305 });
	});

	it("prefers caret coordinates when the editor exposes CodeMirror geometry", () => {
		const app = new App();
		const view = {
			containerEl: document.createElement("div"),
			editor: {
				getCursor: () => ({ line: 3, ch: 7 }),
				posToOffset: (pos: { line: number; ch: number }) => pos.line * 100 + pos.ch,
				cm: {
					coordsAtPos: vi.fn().mockReturnValue({
						left: 420,
						top: 240,
						bottom: 258,
					}),
				},
			},
		} as unknown as MarkdownView;
		app.workspace.getActiveViewOfType = () => view as never;

		expect(getEditorMenuPosition(app)).toEqual({ x: 420, y: 258 });
		expect(
			(view.editor as unknown as { cm: { coordsAtPos: unknown } }).cm.coordsAtPos,
		).toHaveBeenCalledWith(307);
	});
});
