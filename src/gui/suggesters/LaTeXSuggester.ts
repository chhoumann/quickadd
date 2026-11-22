import { TextInputSuggest } from "./suggest";
import Fuse from "fuse.js";
import { renderMath, type App } from "obsidian";
import { LATEX_CURSOR_MOVE_HERE, LaTeXSymbols } from "../../LaTeXSymbols";

const LATEX_REGEX = new RegExp(/\\([a-z{}A-Z0-9]*)$/);

// Module-level cache of rendered MathJax preview nodes, keyed by symbol.
// Survives LaTeXSuggester re-construction so the render burst is paid at most
// once per symbol per session, and only for symbols the user actually sees.
// `null` records a symbol Obsidian's renderer cannot handle, so it is not
// retried on every modal open.
const renderedMathCache = new Map<string, HTMLElement | null>();

// One index per symbol list, built on first search, so a suggester never
// searches another list's symbols.
const fuseIndexes = new WeakMap<readonly string[], Fuse<string>>();

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

function getFuseIndex(symbols: readonly string[]): Fuse<string> {
	let index = fuseIndexes.get(symbols);
	if (!index) {
		index = new Fuse(symbols, { findAllMatches: true, threshold: 0.8 });
		fuseIndexes.set(symbols, index);
	}
	return index;
}

/**
 * Moves the caret to the first LaTeX cursor marker in `input` and removes the
 * marker. Returns false when the input holds none.
 */
export function moveCursorToMarker(input: HTMLInputElement | HTMLTextAreaElement): boolean {
	const at = input.value.indexOf(LATEX_CURSOR_MOVE_HERE);
	if (at === -1) return false;
	input.value = input.value.slice(0, at) + input.value.slice(at + LATEX_CURSOR_MOVE_HERE.length);
	input.setSelectionRange(at, at);
	return true;
}

export class LaTeXSuggester extends TextInputSuggest<string> {
	private lastInput = "";
	private readonly symbols: readonly string[] = LaTeXSymbols;

	constructor(app: App, public inputEl: HTMLInputElement | HTMLTextAreaElement) {
		super(app, inputEl);
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
				val.toLowerCase().includes(this.lastInput)
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

		if (!(item.includes(LATEX_CURSOR_MOVE_HERE) && moveCursorToMarker(this.inputEl))) {
			this.inputEl.setSelectionRange(insertedEndPosition, insertedEndPosition);
		}
	}
}
