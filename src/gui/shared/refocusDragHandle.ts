import { tick } from "svelte";

/**
 * After a keyboard reorder the row's `<li>` is remounted and Chromium blurs
 * the handle, so a second ArrowUp/Down is a no-op. Wait a tick, then put
 * focus back on the handle that still owns `label`.
 */
export async function refocusDragHandle(
	root: ParentNode | null | undefined,
	label: string,
): Promise<void> {
	await tick();
	if (!root) return;
	const handle = root.querySelector(
		`button[aria-label=${JSON.stringify(label)}]`,
	) as HTMLButtonElement | null;
	handle?.focus();
}
