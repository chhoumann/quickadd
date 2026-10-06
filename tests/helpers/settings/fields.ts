import { flushSync } from "svelte";


export function settingItem(container: HTMLElement, name: string): HTMLElement {
	const item = Array.from(container.querySelectorAll(".setting-item")).find(
		(el) =>
			el.querySelector(".setting-item-name")?.textContent?.trim() === name,
	);
	if (!item) throw new Error(`Setting item not found: ${name}`);
	return item as HTMLElement;
}

export function settingNames(container: HTMLElement): string[] {
	return Array.from(container.querySelectorAll(".setting-item-name")).map(
		(el) => el.textContent ?? "",
	);
}

export function choiceIconInput(container: HTMLElement): HTMLInputElement {
	const el = container.querySelector<HTMLInputElement>(
		'input[aria-label="Choice icon"]',
	);
	if (!el) throw new Error("Choice icon input not found");
	return el;
}

/** Show a builder's More settings, if they are not showing. */
export function openMoreSettings(container: HTMLElement): void {
	const button = container.querySelector<HTMLButtonElement>('.qaMoreSettings button[aria-label="More settings"]');
	if (!button) throw new Error("More settings not found");
	if (button.getAttribute("aria-expanded") !== "true") {
		button.click();
		flushSync();
	}
}
