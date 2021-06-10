import {App, Modal} from "obsidian";
import GenericYesNoPromptContent from "./GenericYesNoPromptContent.svelte"

export default class GenericYesNoPrompt extends Modal {
    private modalContent: GenericYesNoPromptContent ;
    private resolvePromise: (input: boolean) => void;
    private rejectPromise: (reason?: any) => void;
    private input: boolean;
    public waitForClose: Promise<boolean>;
    private didSubmit: boolean = false;

    public static Prompt(app: App, header: string, text?: string): Promise<boolean> {
        const newPromptModal = new GenericYesNoPrompt(app, header, text);
        return newPromptModal.waitForClose;
    }

    private constructor(app: App, header: string, text?: string) {
        super(app);

        this.modalContent = new GenericYesNoPromptContent({
            target: this.contentEl,
            props: {
                app,
                header,
                text,
                onSubmit: (input: boolean) => {
                    this.input = input;
                    this.didSubmit = true;
                    this.close();
                }
            }
        });

        this.waitForClose = new Promise<boolean>(
            (resolve, reject) => {
                this.resolvePromise = resolve;
                this.rejectPromise = reject;
            }
        );

        this.open();
    }

    onClose() {
        super.onClose();
        this.modalContent.$destroy();

        if(!this.didSubmit) this.rejectPromise("No answer given.");
        else this.resolvePromise(this.input);
    }
}