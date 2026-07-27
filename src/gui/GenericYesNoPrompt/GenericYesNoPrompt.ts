import type { App } from "obsidian";
import { ButtonComponent, Modal } from "obsidian";

/**
 * A yes/no dialog. Walking away from it is an answer, not an error: dismissing
 * the dialog (Esc, the close button, clicking outside) never rejects.
 *
 * Use {@link GenericYesNoPrompt.Prompt} for confirmations, where a dismissal is
 * simply "no". Use {@link GenericYesNoPrompt.Ask} only where a dismissal has to
 * be told apart from an explicit "No".
 */
export default class GenericYesNoPrompt extends Modal {
	private resolvePromise: (input: boolean | null) => void;
	/** `null` until an answer is given, which is what a dismissal resolves. */
	private input: boolean | null = null;
	public waitForClose: Promise<boolean | null>;

	/**
	 * Ask a yes/no question, keeping "No" and "the user walked away" apart.
	 *
	 * Yes = `true`, No = `false`, dismissed = `null`. Never rejects.
	 */
	public static Ask(
		app: App,
		header: string,
		text?: string
	): Promise<boolean | null> {
		const newPromptModal = new GenericYesNoPrompt(app, header, text);
		return newPromptModal.waitForClose;
	}

	/**
	 * Ask for confirmation. Only an explicit "Yes" confirms, so dismissing the
	 * dialog counts as "No". Never rejects.
	 */
	public static async Prompt(
		app: App,
		header: string,
		text?: string
	): Promise<boolean> {
		return (await GenericYesNoPrompt.Ask(app, header, text)) === true;
	}

	private constructor(
		app: App,
		private header: string,
		private text?: string
	) {
		super(app);

		this.waitForClose = new Promise<boolean | null>((resolve) => {
			this.resolvePromise = resolve;
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
		suppressPointerPress(noButton.buttonEl);

		const yesButton = new ButtonComponent(buttonsDiv)
			.setButtonText("Yes")
			.onClick(() => this.submit(true))
			.setDestructive();
		suppressPointerPress(yesButton.buttonEl);

		yesButton.buttonEl.focus();

		addArrowKeyNavigation([noButton.buttonEl, yesButton.buttonEl]);
	}

	private submit(input: boolean) {
		this.input = input;
		this.close();
	}

	onClose() {
		super.onClose();

		this.resolvePromise(this.input);
	}
}

function suppressPointerPress(button: HTMLButtonElement): void {
	const suppress = (event: MouseEvent | PointerEvent) => {
		event.preventDefault();
		event.stopPropagation();
	};

	button.addEventListener("pointerdown", suppress);
	button.addEventListener("mousedown", suppress);
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
