import { tick } from "svelte";
import { alertToScreenReader } from "svelte-dnd-action";
import { moveById, type Reorderable } from "./dndReorder";

/**
 * Keyboard reorder (ArrowUp/ArrowDown on a row's drag handle), shared by every
 * drag zone: move `id` one step, commit the new order, announce it, and put
 * focus back on the handle. The zones set autoAriaDisabled, so the library's
 * own move alerts are silent and each zone owes this announcement.
 */
export function moveByKeyboard<T extends Reorderable>(opts: {
	listEl: HTMLElement | undefined;
	items: readonly T[];
	id: string;
	delta: -1 | 1;
	describe: (item: T) => string;
	commit: (next: T[]) => void;
}): void {
	const label = opts.listEl?.ownerDocument.activeElement?.getAttribute("aria-label");
	const next = moveById(opts.items, opts.id, opts.delta);
	if (!next) return;
	const target = next.findIndex((item) => item.id === opts.id);
	opts.commit(next);
	alertToScreenReader(
		`Moved ${opts.describe(next[target])} to position ${target + 1} of ${next.length}`,
	);
	if (label) void refocusDragHandle(opts.listEl, label);
}

/**
 * After a keyboard reorder the row's `<li>` is remounted and Chromium blurs
 * the handle, so a second ArrowUp/Down is a no-op. Wait a tick, then put
 * focus back on the handle that still owns `label`.
 */
async function refocusDragHandle(root: ParentNode | undefined, label: string): Promise<void> {
	await tick();
	const handle = root?.querySelector<HTMLButtonElement>(
		`button[aria-label="${CSS.escape(label)}"]`,
	);
	handle?.focus();
}
