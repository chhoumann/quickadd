

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
