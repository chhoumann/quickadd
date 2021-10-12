import {App, ButtonComponent, Modal, TextComponent} from "obsidian";

export default class GenericInputPrompt extends Modal {
    public waitForClose: Promise<string>;

    private resolvePromise: (input: string) => void;
    private rejectPromise: (reason?: any) => void;
    private didSubmit: boolean = false;
    private inputEl: TextComponent;
    private input: string;
    private readonly placeholder: string;


    public static Prompt(app: App, header: string, placeholder?: string, value?: string): Promise<string> {
        const newPromptModal = new GenericInputPrompt(app, header, placeholder, value);
        return newPromptModal.waitForClose;
    }

    protected constructor(app: App, private header: string, placeholder?: string, value?: string) {
        super(app);
        this.placeholder = placeholder;
        this.input = value;

        this.waitForClose = new Promise<string>(
            (resolve, reject) => {
                this.resolvePromise = resolve;
                this.rejectPromise = reject;
            }
        );

        this.display();
        this.open();
    }

    private display() {
        this.contentEl.empty();
        this.titleEl.textContent = this.header;

        const mainContentContainer: HTMLDivElement = this.contentEl.createDiv();
        this.inputEl = this.createInputField(mainContentContainer, this.placeholder, this.input);
        this.createButtonBar(mainContentContainer);
    }

    protected createInputField(container: HTMLElement, placeholder?: string, value?: string) {
        const textComponent = new TextComponent(container);

        textComponent.inputEl.style.width = "100%";
        textComponent.setPlaceholder(placeholder)
            .setValue(value)
            .onChange(value => this.input = value)
            .inputEl.addEventListener('keydown', this.submitEnterCallback);

        return textComponent;
    }

    private createButton(container: HTMLElement, text: string, callback: (evt: MouseEvent) => any) {
        const btn = new ButtonComponent(container);
        btn.setButtonText(text)
            .onClick(callback);

        return btn;
    }

    private createButtonBar(mainContentContainer: HTMLDivElement) {
        const buttonBarContainer: HTMLDivElement = mainContentContainer.createDiv();
        this.createButton(buttonBarContainer, "Ok", this.submitClickCallback)
            .setCta().buttonEl.style.marginRight = '0';
        this.createButton(buttonBarContainer, "Cancel", this.cancelClickCallback);

        buttonBarContainer.style.display = 'flex';
        buttonBarContainer.style.flexDirection = 'row-reverse';
        buttonBarContainer.style.justifyContent = 'flex-start';
        buttonBarContainer.style.marginTop = '1rem';
    }

    private submitClickCallback = (evt: MouseEvent) => this.submit();
    private cancelClickCallback = (evt: MouseEvent) => this.cancel();

    private submitEnterCallback = (evt: KeyboardEvent) => {
        if (evt.key === "Enter") {
            evt.preventDefault();
            this.submit();
        }
    }

    private submit() {
        this.didSubmit = true;

        this.close();
    }

    private cancel() {
        this.close();
    }

    private resolveInput() {
        if(!this.didSubmit) this.rejectPromise("No input given.");
        else this.resolvePromise(this.input);
    }

    private removeInputListener() {
        this.inputEl.inputEl.removeEventListener('keydown', this.submitEnterCallback)
    }

    onOpen() {
        super.onOpen();

        this.inputEl.inputEl.focus();
        this.inputEl.inputEl.select();
    }

    onClose() {
        super.onClose();
        this.resolveInput();
        this.removeInputListener();
    }
}