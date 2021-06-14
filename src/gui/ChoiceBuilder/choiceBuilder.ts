import {App, Modal, SearchComponent, Setting} from "obsidian";
import type IChoice from "../../types/choices/IChoice";
import type {SvelteComponent} from "svelte";
import {GenericTextSuggester} from "../genericTextSuggester";

export abstract class ChoiceBuilder extends Modal {
    private resolvePromise: (input: IChoice) => void;
    private rejectPromise: (reason?: any) => void;
    private input: IChoice;
    public waitForClose: Promise<IChoice>;
    abstract choice: IChoice;
    private didSubmit: boolean = false;
    protected svelteElements: SvelteComponent[] = [];

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

    protected reload() {
        this.contentEl.empty();
        this.display();
    }

    protected addFileSearchInputToSetting(setting: Setting, value: string, onChangeCallback: (value: string) => void): SearchComponent {
        let component: SearchComponent;

        setting.addSearch(searchComponent => {
            component = searchComponent;
           searchComponent.setValue(value);
           searchComponent.setPlaceholder("File path");

           const markdownFiles: string[] = this.app.vault.getMarkdownFiles().map(f => f.path);
           new GenericTextSuggester(this.app, searchComponent.inputEl, markdownFiles);

           searchComponent.onChange(onChangeCallback);
        });

        return component;
    }

    protected addCenteredHeader(header: string): void {
        const headerEl = this.contentEl.createEl('h2');
        headerEl.style.textAlign = "center";
        headerEl.setText(header);
    }

    onClose() {
        super.onClose();
        this.resolvePromise(this.choice);
        this.svelteElements.forEach(el => {
            if (el && el.$destroy) el.$destroy();
        })

        if(!this.didSubmit) this.rejectPromise("No answer given.");
        else this.resolvePromise(this.input);
    }
}