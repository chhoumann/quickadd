import { type App, ConfirmationModal } from "obsidian";

type ConfirmActionOptions = {
	title: string;
	message?: string;
	/** Label of the button that confirms, a verb such as "Delete". */
	action: string;
	/** Style the action like Obsidian's own "Delete file" dialog. Default true. */
	destructive?: boolean;
};

/**
 * Ask before QuickAdd does something, in Obsidian's own confirmation dialog.
 * Resolves `true` only when the action button is used; Cancel, Esc, the close
 * button and clicking outside all resolve `false`. Never rejects.
 */
export function confirmAction(
	app: App,
	{ title, message, action, destructive = true }: ConfirmActionOptions,
): Promise<boolean> {
	return new Promise((resolve) => {
		let confirmed = false;
		const modal = new ConfirmationModal(app);
		modal.setTitle(title);
		if (message) modal.setContent(message);
		modal.addCancelButton().addButton((button) => {
			button
				.setButtonText(action)
				.setCta()
				.setInitialFocus()
				.onClick(() => {
					confirmed = true;
				});
			if (destructive) button.setDestructive();
		});
		modal.buttonContainerEl
			.querySelectorAll("button")
			.forEach(suppressPointerPress);
		modal.setCloseCallback(() => resolve(confirmed));
		modal.open();
	});
}

/**
 * Keep a press on a dialog button from reaching the editor under the dialog,
 * which moved the caret on mobile (#443). The click still fires.
 */
export function suppressPointerPress(button: HTMLButtonElement): void {
	const suppress = (event: MouseEvent | PointerEvent) => {
		event.preventDefault();
		event.stopPropagation();
	};

	button.addEventListener("pointerdown", suppress);
	button.addEventListener("mousedown", suppress);
}

/** Left and right arrows move focus between a dialog's buttons, wrapping around. */
export function addArrowKeyNavigation(buttons: HTMLButtonElement[]): void {
	buttons.forEach((button) => {
		button.addEventListener("keydown", (event) => {
			if (event.key === "ArrowRight" || event.key === "ArrowLeft") {
				const currentIndex = buttons.indexOf(button);
				const nextIndex =
					(currentIndex +
						(event.key === "ArrowRight" ? 1 : -1) +
						buttons.length) %
					buttons.length;
				buttons[nextIndex].focus();
				event.preventDefault();
			}
		});
	});
}
