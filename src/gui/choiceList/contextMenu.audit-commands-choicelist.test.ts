import { describe, expect, it, vi } from "vitest";
import { Menu } from "obsidian";
import type IChoice from "../../types/choices/IChoice";
import type IMultiChoice from "../../types/choices/IMultiChoice";
import type { ChoiceListActions } from "./choiceListActions";
import {
	choiceRowMenu,
	isChoiceNested,
	MOVE_TO_ROOT_TARGET_ID,
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

const noopActions = {
	onRenameChoice: vi.fn(),
	onToggleCommand: vi.fn(),
	onConfigureChoice: vi.fn(),
	onDuplicateChoice: vi.fn(),
	onDeleteChoice: vi.fn(),
	onMoveChoice: vi.fn(),
} as unknown as ChoiceListActions;

const openMenu = (choice: IChoice, roots: IChoice[], actions: ChoiceListActions) =>
	choiceRowMenu(() => ({ choice, roots, actions })).onContextMenu({
		preventDefault: vi.fn(),
	} as unknown as MouseEvent);

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
			const onMoveChoice = vi.fn();

			openMenu(child, [f], { ...noopActions, onMoveChoice });

			const moveToRoot = lastShownItems().find(
				(i) => i.title === "Move to: (root)",
			);
			expect(moveToRoot).toBeDefined();

			moveToRoot?.clickHandler?.();
			expect(onMoveChoice).toHaveBeenCalledWith(child, MOVE_TO_ROOT_TARGET_ID);
		});

		it("is NOT offered for a top-level choice", () => {
			const a = leaf("A");
			openMenu(a, [a, folder("F")], noopActions);

			const moveToRoot = lastShownItems().find(
				(i) => i.title === "Move to: (root)",
			);
			expect(moveToRoot).toBeUndefined();
		});
	});
});
