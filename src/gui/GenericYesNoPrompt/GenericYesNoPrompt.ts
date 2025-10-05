import type { App } from "obsidian";
import { ButtonComponent, Modal } from "obsidian";

export default class GenericYesNoPrompt extends Modal {
	private resolvePromise: (input: boolean) => void;
	private rejectPromise: (reason?: unknown) => void;
	private input: boolean;
	public waitForClose: Promise<boolean>;
	private didSubmit = false;

	public static Prompt(
		app: App,
		header: string,
		text?: string
	): Promise<boolean> {
		const newPromptModal = new GenericYesNoPrompt(app, header, text);
		return newPromptModal.waitForClose;
	}

	private constructor(
		app: App,
		private header: string,
		private text?: string
	) {
		super(app);

		this.waitForClose = new Promise<boolean>((resolve, reject) => {
			this.resolvePromise = resolve;
			this.rejectPromise = reject;
		});

		this.open();
		this.display();
	}

	private display() {
		this.containerEl.addClass("quickAddModal", "qaYesNoPrompt");
		this.contentEl.empty();
		this.titleEl.textContent = this.header;
		this.contentEl.createEl("p", { text: this.text });

		const buttonsDiv = this.contentEl.createDiv({
			cls: "yesNoPromptButtonContainer",
		});

		const noButton = new ButtonComponent(buttonsDiv)
			.setButtonText("No")
			.onClick(() => this.submit(false));

		const yesButton = new ButtonComponent(buttonsDiv)
			.setButtonText("Yes")
			.onClick(() => this.submit(true))
			.setWarning();

		yesButton.buttonEl.focus();

		addArrowKeyNavigation([noButton.buttonEl, yesButton.buttonEl]);
	}

	private submit(input: boolean) {
		this.input = input;
		this.didSubmit = true;
		this.close();
	}

	onClose() {
		super.onClose();

		if (!this.didSubmit) this.rejectPromise("No answer given.");
		else this.resolvePromise(this.input);
	}
}

function addArrowKeyNavigation(buttons: HTMLButtonElement[]): void {
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
