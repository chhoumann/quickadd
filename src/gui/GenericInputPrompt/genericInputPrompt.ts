import {App, Modal} from "obsidian";
import GenericInputPromptContent from "./GenericInputPromptContent.svelte"

export default class GenericInputPrompt extends Modal {
    private modalContent: GenericInputPromptContent;
    private resolvePromise: (input: string) => void;
    private input: string;
    public waitForClose: Promise<string>;
    private rejectPromise: (reason?: any) => void;
    private didSubmit: boolean = false;

    public static Prompt(app: App, header: string, placeholder?: string, value?: string): Promise<string> {
        const newPromptModal = new GenericInputPrompt(app, header, placeholder, value);
        return newPromptModal.waitForClose;
    }

    private constructor(app: App, header: string, placeholder?: string, value?: string) {
        super(app);

        this.modalContent = new GenericInputPromptContent({
            target: this.contentEl,
            props: {
                header,
                placeholder,
                value,
                onSubmit: (input: string) => {
                    this.input = input;
                    this.didSubmit = true;
                    this.close();
                }
            }
        });

        this.waitForClose = new Promise<string>(
            (resolve, reject) => {
                this.resolvePromise = resolve;
                this.rejectPromise = reject;
            }
        );

        this.open();
    }

    onOpen() {
        super.onOpen();

        const modalPrompt: HTMLElement = document.querySelector('.quickAddPrompt');
        const modalInput: any = modalPrompt.querySelector('.quickAddPromptInput');
        modalInput.focus();
        modalInput.select();
    }

    onClose() {
        super.onClose();
        this.modalContent.$destroy();

        if(!this.didSubmit) this.rejectPromise("No input given.");
        else this.resolvePromise(this.input);
    }
}