import {TextInputSuggest} from "./suggest";
import type {App, TAbstractFile} from "obsidian";
import {TFile} from "obsidian";
import {FILE_LINK_REGEX, TAG_REGEX} from "../constants";
import Fuse from "fuse.js";

enum TagOrFile {
    Tag, File
}

export class SilentFileAndTagSuggester extends TextInputSuggest<string> {
    private lastInput: string = "";
    private lastInputType: TagOrFile;
    private files: TFile[];
    private unresolvedLinkNames: string[];
    private tags: string[];

    constructor(public app: App, public inputEl: HTMLTextAreaElement) {
        super(app, inputEl);
        this.files = app.vault.getMarkdownFiles();
        this.unresolvedLinkNames = this.getUnresolvedLinkNames(app);

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
            suggestions = this.files
                .filter(file => file.basename.toLowerCase().contains(fileNameInput.toLowerCase()))
                .map(file => file.path);
            suggestions.push(...this.unresolvedLinkNames.filter(name => name.toLowerCase().contains(fileNameInput.toLowerCase())));
        }

        const fuse = new Fuse(suggestions, {findAllMatches: true, threshold: 0.8});
        return fuse.search(this.lastInput).map(value => value.item);
    }

    renderSuggestion(item: string, el: HTMLElement): void {
        if (item) el.setText(item);
    }

    selectSuggestion(item: string): void {
        const cursorPosition: number = this.inputEl.selectionStart;
        const lastInputLength: number = this.lastInput.length;
        const currentInputValue: string = this.inputEl.value;
        let insertedEndPosition: number = 0;

        if (this.lastInputType === TagOrFile.File) {
            const linkFile: TAbstractFile = this.app.vault.getAbstractFileByPath(item);

            if (linkFile instanceof TFile) {
                insertedEndPosition = this.makeLinkObsidianMethod(linkFile, currentInputValue, cursorPosition, lastInputLength);
            } else {
                insertedEndPosition = this.makeLinkManually(currentInputValue, item.replace(/.md$/, ''), cursorPosition, lastInputLength);
            }

        }

        if (this.lastInputType === TagOrFile.Tag) {
            this.inputEl.value = this.getNewInputValueForTag(currentInputValue, item, cursorPosition, lastInputLength);
            insertedEndPosition = cursorPosition - lastInputLength + item.length - 1;
        }

        this.inputEl.trigger("input");
        this.close();
        this.inputEl.setSelectionRange(insertedEndPosition, insertedEndPosition);
    }

    private makeLinkObsidianMethod(linkFile: TFile, currentInputValue: string, cursorPosition: number, lastInputLength: number) {
        const link = this.app.fileManager.generateMarkdownLink(linkFile, '');
        this.inputEl.value = this.getNewInputValueForFileLink(currentInputValue, link, cursorPosition, lastInputLength);
        return cursorPosition - lastInputLength + link.length + 2;
    }

    private makeLinkManually(currentInputValue: string, item: string, cursorPosition: number, lastInputLength: number) {
        this.inputEl.value = this.getNewInputValueForFileName(currentInputValue, item, cursorPosition, lastInputLength);
        return cursorPosition - lastInputLength + item.length + 2;
    }

    private getNewInputValueForFileLink(currentInputElValue: string, selectedItem: string, cursorPosition: number, lastInputLength: number): string {
        return `${currentInputElValue.substr(0, cursorPosition - lastInputLength - 2)}${selectedItem}${currentInputElValue.substr(cursorPosition)}`;
    }

    private getNewInputValueForFileName(currentInputElValue: string, selectedItem: string, cursorPosition: number, lastInputLength: number): string {
        return `${currentInputElValue.substr(0, cursorPosition - lastInputLength)}${selectedItem}]]${currentInputElValue.substr(cursorPosition)}`;
    }

    private getNewInputValueForTag(currentInputElValue: string, selectedItem: string, cursorPosition: number, lastInputLength: number) {
        return `${currentInputElValue.substr(0, cursorPosition - lastInputLength - 1)}${selectedItem}${currentInputElValue.substr(cursorPosition)}`;
    }

    private getUnresolvedLinkNames(app: App): string[] {
        const unresolvedLinks: Record<string, Record<string, number>> = app.metadataCache.unresolvedLinks;
        const unresolvedLinkNames: Set<string> = new Set<string>();

        for (const sourceFileName in unresolvedLinks) {
            for (const unresolvedLink in unresolvedLinks[sourceFileName]) {
                unresolvedLinkNames.add(unresolvedLink);
            }
        }

        return Array.from(unresolvedLinkNames);
    }
}