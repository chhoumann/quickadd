import { Menu, type MenuItem } from "obsidian";

/**
 * Click the Add a step button in `container` and return the menu it opened,
 * as its rows' titles (a group label as `[Write]`) and a way to pick one.
 */
export function openAddStepMenu(container: HTMLElement) {
	const button = Array.from(container.querySelectorAll("button")).find(
		(el) => el.getAttribute("aria-label") === "Add a step",
	);
	if (!button) throw new Error("Add a step button not found");
	(Menu as unknown as { lastShown: Menu | null }).lastShown = null;
	button.click();
	const menu = (Menu as unknown as { lastShown: (Menu & { items: StubItem[] }) | null }).lastShown;
	if (!menu) throw new Error("Add a step opened no menu");
	return {
		titles: menu.items.map((item) => (item.isLabel ? `[${item.title}]` : item.title)),
		pick(title: string) {
			const item = menu.items.find((entry) => !entry.isLabel && entry.title === title);
			if (!item?.clickHandler) throw new Error(`No menu item '${title}'`);
			item.clickHandler();
		},
	};
}

type StubItem = MenuItem & { title: string; isLabel: boolean; clickHandler: (() => void) | null };
