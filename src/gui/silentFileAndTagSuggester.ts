import {TextInputSuggest} from "./suggest";
import type {App} from "obsidian";
import {FILE_LINK_REGEX, TAG_REGEX} from "../constants";

enum TagOrFile {
    Tag, File
}

export class SilentFileAndTagSuggester extends TextInputSuggest<string> {
    private lastInput: string = "";
    private lastInputType: TagOrFile;
    private fileNames: string[];
    private tags: string[];

    constructor(public app: App, public inputEl: HTMLInputElement) {
        super(app, inputEl);
        this.fileNames = app.vault.getMarkdownFiles().map(f => f.basename);
        // @ts-ignore
        this.tags = Object.keys(app.metadataCache.getTags());
    }

    getSuggestions(inputStr: string): string[] {
        const cursorPosition: number = this.inputEl.selectionStart;
        const inputBeforeCursor: string = inputStr.substr(0, cursorPosition);
        const fileLinkMatch = FILE_LINK_REGEX.exec(inputBeforeCursor);
        const tagMatch = TAG_REGEX.exec(inputBeforeCursor);

        let suggestions: string[] = [];

        if (tagMatch) {
            const tagInput: string = tagMatch[1];
            this.lastInput = tagInput;
            this.lastInputType = TagOrFile.Tag;
            suggestions = this.tags.filter(tag => tag.toLowerCase().contains(tagInput.toLowerCase()));
        }

        if (fileLinkMatch) {
            const fileNameInput: string = fileLinkMatch[1];
            this.lastInput = fileNameInput;
            this.lastInputType = TagOrFile.File;
            suggestions = this.fileNames.filter(filePath => filePath.toLowerCase().contains(fileNameInput.toLowerCase()));
        }

        return suggestions;
    }

    renderSuggestion(item: string, el: HTMLElement): void {
        if (item) el.setText(item);
    }

    selectSuggestion(item: string): void {
        const cursorPosition: number = this.inputEl.selectionStart;
        const lastInputLength: number = this.lastInput.length;
        const currentInputValue: string = this.inputEl.value;

        if (this.lastInputType === TagOrFile.File) {
            this.inputEl.value = this.getNewInputValueForFileName(currentInputValue, item, cursorPosition, lastInputLength);
        }

        if (this.lastInputType === TagOrFile.Tag) {
            this.inputEl.value = this.getNewInputValueForTag(currentInputValue, item, cursorPosition, lastInputLength);
        }

        this.inputEl.trigger("input");
        this.close();
    }

    private getNewInputValueForFileName(currentInputElValue: string, selectedItem: string, cursorPosition: number, lastInputLength: number): string {
        return `${currentInputElValue.substr(0, cursorPosition - lastInputLength)}${selectedItem}]]${currentInputElValue.substr(cursorPosition)}`;
    }

    private getNewInputValueForTag(currentInputElValue: string, selectedItem: string, cursorPosition: number, lastInputLength: number) {
        return `${currentInputElValue.substr(0, cursorPosition - lastInputLength - 1)}${selectedItem}${currentInputElValue.substr(cursorPosition)}`;
    }
}