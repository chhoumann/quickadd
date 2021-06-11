import {TextInputSuggest} from "./suggest";
import type {App} from "obsidian";

export class FormatSyntaxSuggester extends TextInputSuggest<string> {
     constructor(public app: App, public inputEl: HTMLInputElement | HTMLTextAreaElement, private items: string[]) {
        super(app, inputEl);
    }

    getSuggestions(inputStr: string): string[] {
        return this.items;
    }

    selectSuggestion(item: string): void {
        this.inputEl.value += item;
        this.inputEl.trigger("input");
        this.close();
    }

    renderSuggestion(value: string, el: HTMLElement): void {
        if (value)
            el.setText(value);
    }
}