import {TextInputSuggest} from "./suggest";
import Fuse from "fuse.js";
import {renderMath} from "obsidian";
import {LATEX_CURSOR_MOVE_HERE, LaTeXSymbols} from "../../LaTeXSymbols";
import QuickAdd from "../../main";

const LATEX_REGEX = new RegExp(/\\([a-z{}A-Z0-9]*)$/);

export class LaTeXSuggester extends TextInputSuggest<string> {
    private lastInput: string = "";
    private symbols;
    private elementsRendered;

    constructor(public inputEl: HTMLInputElement | HTMLTextAreaElement) {
        super(QuickAdd.instance.app, inputEl);
        this.symbols = Object.assign([], LaTeXSymbols);

        this.elementsRendered = this.symbols.reduce((elements, symbol) => {
            try {
                elements[symbol.toString()] = renderMath(symbol, true);
            } catch {} // Ignoring symbols that we can't use

            return elements;
        }, {});
    }

    getSuggestions(inputStr: string): string[] {
        const cursorPosition: number = this.inputEl.selectionStart;
        const inputBeforeCursor: string = inputStr.substr(0, cursorPosition);
        const lastBackslashPos: number = inputBeforeCursor.lastIndexOf("\\");
        const commandText = inputBeforeCursor.substr(lastBackslashPos);

        const match = LATEX_REGEX.exec(commandText);

        let suggestions: string[] = [];

        if (match) {
            this.lastInput = match[1];
            suggestions = this.symbols.filter(val => val.toLowerCase().contains(this.lastInput));
        }

        const fuse = new Fuse(suggestions, {findAllMatches: true, threshold: 0.8});
        const searchResults = fuse.search(this.lastInput);
        return searchResults.map(value => value.item);
    }

    renderSuggestion(item: string, el: HTMLElement): void {
        if (item) {
            el.setText(item);
            el.append(this.elementsRendered[item]);
        }
    }

    selectSuggestion(item: string): void {
        const cursorPosition: number = this.inputEl.selectionStart;
        const lastInputLength: number = this.lastInput.length;
        const currentInputValue: string = this.inputEl.value;
        let insertedEndPosition: number = 0;

        const textToInsert = item.replace(/\\\\/g, "\\");

        this.inputEl.value = `${currentInputValue.substr(0, cursorPosition - lastInputLength - 1)}${textToInsert}${currentInputValue.substr(cursorPosition)}`;
        insertedEndPosition = cursorPosition - lastInputLength + item.length - 1;

        this.inputEl.trigger("input");
        this.close();

        if (item.contains(LATEX_CURSOR_MOVE_HERE)) {
            const cursorPos = this.inputEl.value.indexOf(LATEX_CURSOR_MOVE_HERE);
            this.inputEl.value = this.inputEl.value.replace(LATEX_CURSOR_MOVE_HERE, "");
            this.inputEl.setSelectionRange(cursorPos, cursorPos);
        } else {
            this.inputEl.setSelectionRange(insertedEndPosition, insertedEndPosition);
        }
    }
}