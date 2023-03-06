import { App, ButtonComponent, Modal } from "obsidian";

export default class GenericInfoDialog extends Modal {
	private resolvePromise: () => void;
	public waitForClose: Promise<void>;

	public static Show(
		app: App,
		header: string,
		lines: string[]
	): Promise<void> {
		const newPromptModal = new GenericInfoDialog(app, header, lines);
		return newPromptModal.waitForClose;
	}

	private constructor(
		app: App,
		private header: string,
		private lines: string[]
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

		this.lines.forEach((line) => this.contentEl.createEl("p", { text: line }));

		const buttonsDiv = this.contentEl.createDiv();

		const noButton = new ButtonComponent(buttonsDiv)
			.setButtonText("OK")
			.onClick(() => this.close());

		noButton.buttonEl.focus();
	}

	onClose() {
		super.onClose();
		this.resolvePromise();
	}
}
