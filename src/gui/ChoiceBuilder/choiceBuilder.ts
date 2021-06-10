import {App, Modal} from "obsidian";
import type IChoice from "../../types/choices/IChoice";

export abstract class ChoiceBuilder extends Modal {
    private resolvePromise: (input: IChoice) => void;
    private rejectPromise: (reason?: any) => void;
    private input: IChoice;
    public waitForClose: Promise<IChoice>;
    abstract choice: IChoice;
    private didSubmit: boolean = false;

    protected constructor(app: App) {
        super(app);

        this.waitForClose = new Promise<IChoice>(
            (resolve, reject) => {
                this.resolvePromise = resolve;
                this.rejectPromise = reject;
            }
        );

        this.open();
    }

    protected abstract display();

    onClose() {
        super.onClose();
        this.resolvePromise(this.choice);

        if(!this.didSubmit) this.rejectPromise("No answer given.");
        else this.resolvePromise(this.input);
    }
}