import Fuse from "fuse.js";
import type { App } from "obsidian";
import { TAG_REGEX } from "../../constants";
import { TextInputSuggest } from "./suggest";

export class SilentTagSuggester extends TextInputSuggest<string> {
    private lastInput: string = "";
    private tags: string[];

    constructor(public app: App, public inputEl: HTMLInputElement | HTMLTextAreaElement) {
        super(app, inputEl);

        // @ts-ignore
        this.tags = Object.keys(app.metadataCache.getTags());
    }

    getSuggestions(inputStr: string): string[] {
        const cursorPosition: number = this.inputEl.selectionStart;
        const inputBeforeCursor: string = inputStr.substr(0, cursorPosition);
        const tagMatch = TAG_REGEX.exec(inputBeforeCursor);

        if (!tagMatch) {
            return [];
        }

        const tagInput: string = tagMatch[1];
        this.lastInput = tagInput;
        const suggestions = this.tags.filter(tag => tag.toLowerCase().contains(tagInput.toLowerCase()));

        const fuse = new Fuse(suggestions, {findAllMatches: true, threshold: 0.8});
        const search = fuse.search(this.lastInput).map(value => value.item);

        return search;
    }

    renderSuggestion(item: string, el: HTMLElement): void {
        el.setText(item);
    }

    selectSuggestion(item: string): void {
        const cursorPosition: number = this.inputEl.selectionStart;
        const lastInputLength: number = this.lastInput.length;
        const currentInputValue: string = this.inputEl.value;
        let insertedEndPosition: number = 0;

        this.inputEl.value = this.getNewInputValueForTag(currentInputValue, item, cursorPosition, lastInputLength);
        insertedEndPosition = cursorPosition - lastInputLength + item.length - 1;

        this.inputEl.trigger("input");
        this.close();
        this.inputEl.setSelectionRange(insertedEndPosition, insertedEndPosition);
    }

    private getNewInputValueForTag(currentInputElValue: string, selectedItem: string, cursorPosition: number, lastInputLength: number) {
        return `${currentInputElValue.substr(0, cursorPosition - lastInputLength - 1)}${selectedItem}${currentInputElValue.substr(cursorPosition)}`;
    }
}