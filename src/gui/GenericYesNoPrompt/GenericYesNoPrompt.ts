import {App, ButtonComponent, Modal} from "obsidian";

export default class GenericYesNoPrompt extends Modal {
    private resolvePromise: (input: boolean) => void;
    private rejectPromise: (reason?: any) => void;
    private input: boolean;
    public waitForClose: Promise<boolean>;
    private didSubmit: boolean = false;
    private eventListeners: any[];

    public static Prompt(app: App, header: string, text?: string): Promise<boolean> {
        const newPromptModal = new GenericYesNoPrompt(app, header, text);
        return newPromptModal.waitForClose;
    }

    private constructor(app: App, private header: string, private text?: string) {
        super(app);

        this.waitForClose = new Promise<boolean>(
            (resolve, reject) => {
                this.resolvePromise = resolve;
                this.rejectPromise = reject;
            }
        );

        this.open();
        this.display();
    }

    private display() {
        this.contentEl.empty();
        this.titleEl.textContent = this.header;
        this.contentEl.createEl('p', {text: this.text});

        const buttonsDiv = this.contentEl.createDiv({cls: 'yesNoPromptButtonContainer'})

        const noButton = new ButtonComponent(buttonsDiv)
            .setButtonText('No')
            .onClick(() => this.submit(false));

        const yesButton = new ButtonComponent(buttonsDiv)
            .setButtonText('Yes')
            .onClick(() => this.submit(true))
            .setWarning();

        yesButton.buttonEl.focus();

    }

    private submit(input: boolean) {
        this.input = input;
        this.didSubmit = true;
        this.close();
    }

    onClose() {
        super.onClose();

        if(!this.didSubmit) this.rejectPromise("No answer given.");
        else this.resolvePromise(this.input);
    }
}