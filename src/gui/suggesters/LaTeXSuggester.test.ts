import Fuse from "fuse.js";
import { renderMath } from "obsidian";
import { describe, expect, it, vi } from "vitest";
import { LaTeXSuggester } from "./LaTeXSuggester";

vi.mock("obsidian", async (importOriginal) => ({
	...(await importOriginal<object>()),
	renderMath: vi.fn(() => {
		const el = document.createElement("span");
		el.className = "math-preview";
		return el;
	}),
}));

const symbols = [
	"\\alpha",
	"\\Alpha",
	"\\aleph",
	"\\beta",
	"\\gamma",
	"\\mathcal{A}",
	"\\notalpha",
];

function ensureContainsPolyfill(): void {
	const stringPrototype = String.prototype as typeof String.prototype & {
		contains?: (searchString: string) => boolean;
	};

	if (!stringPrototype.contains) {
		stringPrototype.contains = String.prototype.includes;
	}
}

function oldTwoStageSuggestions(inputStr: string): string[] {
	const inputBeforeCursor = inputStr.slice(0, inputStr.length);
	const lastBackslashPos = inputBeforeCursor.lastIndexOf("\\");
	const commandText = inputBeforeCursor.slice(lastBackslashPos);
	const match = /\\([a-z{}A-Z0-9]*)$/.exec(commandText);

	let lastInput = "";
	let suggestions: string[] = [];

	if (match) {
		lastInput = match[1];
		suggestions = symbols.filter((val) =>
			//@ts-ignore
			val.toLowerCase().contains(lastInput)
		);
	}

	const fuse = new Fuse(suggestions, {
		findAllMatches: true,
		threshold: 0.8,
	});
	return fuse.search(lastInput).map((value) => value.item);
}

function getSuggestions(inputStr: string): string[] {
	return LaTeXSuggester.prototype.getSuggestions.call(
		{
			inputEl: {
				selectionStart: inputStr.length,
			},
			lastInput: "",
			symbols,
		},
		inputStr,
	);
}

describe("LaTeXSuggester", () => {
	describe("getSuggestions", () => {
		it("preserves the old two-stage Fuse ranking after reusing a shared full index", () => {
			ensureContainsPolyfill();

			for (const input of ["\\al", "\\alpha", "\\A", "prefix \\ma"]) {
				expect(getSuggestions(input)).toEqual(oldTwoStageSuggestions(input));
			}
		});

		it("returns no suggestions when there is no LaTeX command match", () => {
			ensureContainsPolyfill();

			expect(getSuggestions("alpha")).toEqual([]);
		});
	});

	describe("renderSuggestion", () => {
		it("clones cached rendered previews for each row", () => {
			const rowA = document.createElement("div");
			const rowB = document.createElement("div");
			const setText = vi.fn(function (this: HTMLElement, text: string) {
				this.textContent = text;
			});
			rowA.setText = setText;
			rowB.setText = setText;

			LaTeXSuggester.prototype.renderSuggestion("\\alpha", rowA);
			LaTeXSuggester.prototype.renderSuggestion("\\alpha", rowB);

			const rendered = vi.mocked(renderMath).mock.results[0].value;
			expect(renderMath).toHaveBeenCalledTimes(1);
			expect(rowA.lastChild).not.toBe(rendered);
			expect(rowB.lastChild).not.toBe(rendered);
			expect(rowA.lastChild).not.toBe(rowB.lastChild);
			expect(rendered.parentElement).toBeNull();
		});
	});
});
