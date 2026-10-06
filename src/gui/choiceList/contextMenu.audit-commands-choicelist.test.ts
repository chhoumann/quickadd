import { describe, expect, it, vi } from "vitest";
import { Menu, Notice, type App } from "obsidian";
import type IChoice from "../../types/choices/IChoice";
import type IMultiChoice from "../../types/choices/IMultiChoice";
import {
	isChoiceNested,
	MOVE_TO_ROOT_TARGET_ID,
	showChoiceContextMenu,
} from "./contextMenu";

let nextId = 0;
const leaf = (name: string): IChoice =>
	({ id: `id-${nextId++}`, name, type: "Template", command: false }) as IChoice;
const folder = (name: string, children: IChoice[] = []): IMultiChoice =>
	({
		id: `id-${nextId++}`,
		name,
		type: "Multi",
		command: false,
		choices: children,
	}) as IMultiChoice;

const fakeApp = {} as unknown as App;

const noopActions = {
	onRename: vi.fn(),
	onToggle: vi.fn(),
	onConfigure: vi.fn(),
	onDuplicate: vi.fn(),
	onDelete: vi.fn(),
	onMove: vi.fn(),
};

describe("contextMenu audit (commands-choicelist)", () => {
	describe("isChoiceNested", () => {
		it("returns false for a top-level choice", () => {
			const a = leaf("A");
			expect(isChoiceNested(a, [a, folder("F")])).toBe(false);
		});

		it("returns true for a choice inside a folder", () => {
			const child = leaf("Child");
			const f = folder("F", [child]);
			expect(isChoiceNested(child, [f])).toBe(true);
		});

		it("returns true for a deeply nested choice", () => {
			const deep = leaf("Deep");
			const inner = folder("Inner", [deep]);
			const outer = folder("Outer", [inner]);
			expect(isChoiceNested(deep, [outer])).toBe(true);
		});

		it("returns false when roots is undefined", () => {
			expect(isChoiceNested(leaf("X"), undefined)).toBe(false);
		});
	});

	describe('"Move to: (root)" menu item', () => {
		const lastShownItems = () =>
			((Menu as unknown as {
				lastShown: {
					items: { title: string; clickHandler: (() => void) | null }[];
				};
			}).lastShown.items);

		it("is offered (wired to the root sentinel) for a nested choice", () => {
			const child = leaf("Child");
			const f = folder("F", [child]);
			const evt = { preventDefault: vi.fn() } as unknown as MouseEvent;
			const onMove = vi.fn();

			showChoiceContextMenu(fakeApp, evt, child, [f], {
				...noopActions,
				onMove,
			});

			const moveToRoot = lastShownItems().find(
				(i) => i.title === "Move to: (root)",
			);
			expect(moveToRoot).toBeDefined();

			moveToRoot?.clickHandler?.();
			expect(onMove).toHaveBeenCalledWith(MOVE_TO_ROOT_TARGET_ID);
		});

		it("is NOT offered for a top-level choice", () => {
			const a = leaf("A");
			const evt = { preventDefault: vi.fn() } as unknown as MouseEvent;

			showChoiceContextMenu(fakeApp, evt, a, [a, folder("F")], {
				...noopActions,
			});

			const moveToRoot = lastShownItems().find(
				(i) => i.title === "Move to: (root)",
			);
			expect(moveToRoot).toBeUndefined();
		});
	});

	describe('"Copy button block" menu item', () => {
		const copyItem = () =>
			(Menu as unknown as {
				lastShown: { items: { title: string; clickHandler: (() => void) | null }[] };
			}).lastShown.items.find((i) => i.title === "Copy button block");

		const notices = () => (Notice as unknown as { instances: { message: string }[] }).instances;

		const copyFor = async (choice: IChoice, roots: IChoice[]) => {
			const writeText = vi.fn(async (_text: string) => {});
			vi.stubGlobal("navigator", { clipboard: { writeText } });
			notices().length = 0;
			showChoiceContextMenu(fakeApp, { preventDefault: vi.fn() } as unknown as MouseEvent, choice, roots, noopActions);
			copyItem()?.clickHandler?.();
			await vi.waitFor(() => expect(notices()).toHaveLength(1));
			return { text: writeText.mock.calls[0]?.[0], notice: notices()[0].message };
		};

		it("copies a block naming the choice and says so", async () => {
			const log = leaf("Log");
			expect(await copyFor(log, [log, folder("F")])).toEqual({
				text: "```quickadd\nLog\n```\n",
				notice: "Copied. Paste it in a note.",
			});
		});

		it("copies the id when another choice shares the name", async () => {
			const log = leaf("Log");
			const other = leaf("Log");
			expect((await copyFor(other, [log, folder("F", [other])])).text).toBe(`\`\`\`quickadd\nid: ${other.id}\n\`\`\`\n`);
		});
	});
});
