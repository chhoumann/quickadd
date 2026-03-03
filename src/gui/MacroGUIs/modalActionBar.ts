import { ButtonComponent } from "obsidian";

export interface ModalActionBarOptions {
	parent: HTMLElement;
	onCancel: () => void;
	onSave: () => void;
	cancelText?: string;
	saveText?: string;
	justifyContent?: "flex-end" | "space-between";
	gapPx?: number;
	marginTopPx?: number;
	cancelWarning?: boolean;
}

export interface ModalActionBar {
	container: HTMLDivElement;
	cancelButton: ButtonComponent;
	saveButton: ButtonComponent;
}

export function renderModalActionBar(
	options: ModalActionBarOptions,
): ModalActionBar {
	const container = options.parent.createDiv();
	container.style.display = "flex";
	container.style.justifyContent = options.justifyContent ?? "flex-end";
	container.style.gap = `${options.gapPx ?? 12}px`;
	container.style.marginTop = `${options.marginTopPx ?? 20}px`;

	const cancelButton = new ButtonComponent(container).setButtonText(
		options.cancelText ?? "Cancel",
	);
	if (options.cancelWarning) {
		cancelButton.setWarning();
	}
	cancelButton.onClick(options.onCancel);

	const saveButton = new ButtonComponent(container)
		.setButtonText(options.saveText ?? "Save")
		.setCta();
	saveButton.onClick(options.onSave);

	return {
		container,
		cancelButton,
		saveButton,
	};
}
