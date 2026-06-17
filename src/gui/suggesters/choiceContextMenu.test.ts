import { beforeEach, describe, expect, it, vi } from "vitest";
import { App, Menu } from "obsidian";
import type { Editor } from "obsidian";
import type { Menu as StubMenu } from "../../../tests/obsidian-stub";
import type QuickAdd from "../../main";
import type { IChoiceExecutor } from "../../IChoiceExecutor";
import type IChoice from "../../types/choices/IChoice";
import type IMultiChoice from "../../types/choices/IMultiChoice";
import {
	getEditorCaretMenuPosition,
	openMultiChoiceContextMenu,
} from "./choiceContextMenu";

const ShownMenu = Menu as unknown as typeof StubMenu;

function choice(id: string, name: string, type: IChoice["type"]): IChoice {
	return { id, name, type, command: false } as IChoice;
}

function multi(id: string, name: string, choices: IChoice[]): IMultiChoice {
	return {
		id,
		name,
		type: "Multi",
		command: false,
		collapsed: false,
		choices,
		displayMode: "context-menu",
	};
}

function pluginWithEditor(coords: { left: number; bottom: number }): QuickAdd {
	const app = new App();
	(app.workspace as unknown as { activeEditor: { editor: Editor } }).activeEditor = {
		editor: {
			getCursor: () => ({ line: 1, ch: 2 }),
			posToOffset: () => 12,
			cm: {
				coordsAtPos: vi.fn(() => ({
					left: coords.left,
					right: coords.left,
					top: coords.bottom - 18,
					bottom: coords.bottom,
				})),
			},
		} as unknown as Editor,
	};
	return { app } as unknown as QuickAdd;
}

function makeExecutor(): IChoiceExecutor & {
	execute: ReturnType<typeof vi.fn>;
} {
	return {
		variables: new Map<string, unknown>(),
		execute: vi.fn(async () => {}),
	};
}

beforeEach(() => {
	ShownMenu.lastShown = null;
	document.body.empty();
});

describe("choice context menu", () => {
	it("opens a Multi as a menu at the editor caret and executes leaf choices", () => {
		const plugin = pluginWithEditor({ left: 14, bottom: 32 });
		const executor = makeExecutor();
		const root = multi("root", "Root", [
			choice("template", "Insert template", "Template"),
		]);

		expect(
			openMultiChoiceContextMenu(plugin, root, { choiceExecutor: executor }),
		).toBe(true);

		expect(ShownMenu.lastShown?.shownAt).toEqual({
			type: "position",
			detail: { x: 14, y: 32 },
		});
		expect(ShownMenu.lastShown?.useNativeMenu).toBe(false);
		const item = ShownMenu.lastShown?.items.find(
			(menuItem) => menuItem.title === "Insert template",
		);
		expect(item?.icon).toBe("file-text");

		item?.clickHandler?.();
		expect(executor.execute).toHaveBeenCalledWith(root.choices[0]);
	});

	it("drills into nested Multi choices and offers a back item", () => {
		const plugin = pluginWithEditor({ left: 5, bottom: 9 });
		const executor = makeExecutor();
		const child = choice("capture", "Capture text", "Capture");
		const nested = multi("nested", "Text actions", [child]);
		const root = multi("root", "Root", [nested]);

		openMultiChoiceContextMenu(plugin, root, { choiceExecutor: executor });
		ShownMenu.lastShown?.items
			.find((menuItem) => menuItem.title === "Text actions ›")
			?.clickHandler?.();

		expect(ShownMenu.lastShown?.items.map((item) => item.title)).toEqual([
			"← Root",
			"Capture text",
		]);
		ShownMenu.lastShown?.items
			.find((menuItem) => menuItem.title === "Capture text")
			?.clickHandler?.();
		expect(executor.execute).toHaveBeenCalledWith(child);
	});

	it("returns false when there is no editor caret position", () => {
		const app = new App();
		const plugin = { app } as unknown as QuickAdd;
		const executor = makeExecutor();

		expect(
			openMultiChoiceContextMenu(plugin, multi("root", "Root", []), {
				choiceExecutor: executor,
			}),
		).toBe(false);
		expect(ShownMenu.lastShown).toBeNull();
	});

	it("can derive position from a visible CodeMirror cursor element", () => {
		const app = new App();
		const cursor = document.body.createDiv({ cls: "cm-cursor-primary" });
		cursor.getBoundingClientRect = () =>
			({
				left: 30,
				right: 31,
				top: 40,
				bottom: 58,
				width: 1,
				height: 18,
			}) as DOMRect;

		expect(getEditorCaretMenuPosition(app)).toEqual({ x: 30, y: 58 });
	});
});
