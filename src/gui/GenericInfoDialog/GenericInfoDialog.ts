import type { App } from "obsidian";
import { ButtonComponent, Modal } from "obsidian";

export default class GenericInfoDialog extends Modal {
	private resolvePromise: () => void;
	public waitForClose: Promise<void>;

	public static Show(
		app: App,
		header: string,
		text: string[] | string
	): Promise<void> {
		const newPromptModal = new GenericInfoDialog(app, header, text);
		return newPromptModal.waitForClose;
	}

	private constructor(
		app: App,
		private header: string,
		private text: string[] | string
	) {
		super(app);

		this.waitForClose = new Promise<void>((resolve) => {
			this.resolvePromise = resolve;
		});

		this.open();
		this.display();
	}

	private display() {
		this.contentEl.empty();
		this.titleEl.textContent = this.header;

		if (String.isString(this.text))
			this.contentEl.createEl("p", { text: this.text });
		else if (Array.isArray(this.text))
			this.text.forEach((line) =>
				this.contentEl.createEl("p", { text: line })
			);

		const buttonsDiv = this.contentEl.createDiv();

		const noButton = new ButtonComponent(buttonsDiv)
			.setButtonText("OK")
			.onClick(() => this.close());

		Object.assign(buttonsDiv.style, {
			display: "flex",
			justifyContent: "flex-end",
		} as Partial<typeof buttonsDiv["style"]>);

		noButton.buttonEl.focus();
	}

	onClose() {
		super.onClose();
		this.resolvePromise();
	}
}
