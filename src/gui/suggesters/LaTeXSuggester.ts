import { TextInputSuggest } from "./suggest";
import Fuse from "fuse.js";
import { renderMath } from "obsidian";
import { LATEX_CURSOR_MOVE_HERE, LaTeXSymbols } from "../../LaTeXSymbols";
import { getQuickAddInstance } from "../../quickAddInstance";

const LATEX_REGEX = new RegExp(/\\([a-z{}A-Z0-9]*)$/);

// Module-level cache of rendered MathJax preview nodes, keyed by symbol.
// Survives LaTeXSuggester re-construction so the render burst is paid at most
// once per symbol per session, and only for symbols the user actually sees.
// `null` records a symbol Obsidian's renderer cannot handle, so it is not
// retried on every modal open.
const renderedMathCache = new Map<string, HTMLElement | null>();

let fuseIndex: Fuse<string> | null = null;

function getRenderedMath(symbol: string): HTMLElement | null {
	if (renderedMathCache.has(symbol)) {
		return renderedMathCache.get(symbol) ?? null;
	}

	let rendered: HTMLElement | null = null;
	try {
		rendered = renderMath(symbol, true);
	} catch {
		// Symbols Obsidian's math renderer cannot render are cached as null.
		rendered = null;
	}

	renderedMathCache.set(symbol, rendered);
	return rendered;
}

function getFuseIndex(symbols: string[]): Fuse<string> {
	if (fuseIndex === null) {
		fuseIndex = new Fuse(symbols, {
			findAllMatches: true,
			threshold: 0.8,
		});
	}

	return fuseIndex;
}

export class LaTeXSuggester extends TextInputSuggest<string> {
	private lastInput = "";
	private symbols: string[];

	constructor(public inputEl: HTMLInputElement | HTMLTextAreaElement) {
		super(getQuickAddInstance().app, inputEl);
		this.symbols = Object.assign([], LaTeXSymbols);
	}

	getSuggestions(inputStr: string): string[] {
		if (this.inputEl.selectionStart === null) {
			return [];
		}

		const cursorPosition: number = this.inputEl.selectionStart;
		const inputBeforeCursor: string = inputStr.slice(0, cursorPosition);
		const lastBackslashPos: number = inputBeforeCursor.lastIndexOf("\\");
		const commandText = inputBeforeCursor.slice(lastBackslashPos);

		const match = LATEX_REGEX.exec(commandText);

		let suggestions: string[] = [];

		if (match) {
			this.lastInput = match[1];
			suggestions = this.symbols.filter((val) =>
				//@ts-ignore
				 
				val.toLowerCase().contains(this.lastInput)
			);
		}

		const allowed = new Set(suggestions);
		const searchResults = getFuseIndex(this.symbols).search(this.lastInput);
		return searchResults
			.map((value) => value.item)
			.filter((item) => allowed.has(item));
	}

	renderSuggestion(item: string, el: HTMLElement): void {
		if (item) {
			el.setText(item);
			const rendered = getRenderedMath(item);
			if (rendered) {
				el.append(rendered.cloneNode(true));
			}
		}
	}

	selectSuggestion(item: string): void {
		if (this.inputEl.selectionStart === null) return;

		const cursorPosition: number = this.inputEl.selectionStart;
		const lastInputLength: number = this.lastInput.length;
		const currentInputValue: string = this.inputEl.value;
		let insertedEndPosition = 0;

		const textToInsert = item.replace(/\\\\/g, "\\");

		this.inputEl.value = `${currentInputValue.slice(
			0,
			cursorPosition - lastInputLength - 1
		)}${textToInsert}${currentInputValue.slice(cursorPosition)}`;
		insertedEndPosition =
			cursorPosition - lastInputLength + item.length - 1;

		this.inputEl.trigger("input");
		this.close();

		if (item.contains(LATEX_CURSOR_MOVE_HERE)) {
			const cursorPos = this.inputEl.value.indexOf(
				LATEX_CURSOR_MOVE_HERE
			);
			this.inputEl.value = this.inputEl.value.replace(
				LATEX_CURSOR_MOVE_HERE,
				""
			);
			this.inputEl.setSelectionRange(cursorPos, cursorPos);
		} else {
			this.inputEl.setSelectionRange(
				insertedEndPosition,
				insertedEndPosition
			);
		}
	}
}
