// @vitest-environment jsdom
import { renderMath } from "obsidian";
import type { App } from "obsidian";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LaTeXSuggester } from "./LaTeXSuggester";

vi.mock("obsidian", async (importOriginal) => ({
	...(await importOriginal<object>()),
	renderMath: vi.fn(() => {
		const el = document.createElement("span");
		el.className = "math-preview";
		return el;
	}),
}));

function createSuggester() {
	const app = {
		dom: { appContainerEl: document.body },
		keymap: { pushScope: vi.fn(), popScope: vi.fn() },
	} as unknown as App;
	const input = document.createElement("textarea");
	document.body.appendChild(input);
	const suggester = new LaTeXSuggester(app, input);
	/** Suggestions for `value` with the caret at `caret` (default: the end). */
	const suggest = (value: string, caret = value.length) => {
		input.value = value;
		input.setSelectionRange(caret, caret);
		return suggester.getSuggestions(value);
	};
	return { suggester, suggest };
}

describe("LaTeXSuggester", () => {
	afterEach(() => {
		document.body.replaceChildren();
	});

	describe("getSuggestions", () => {
		it("returns only the symbol for an exact command", () => {
			const { suggest } = createSuggester();

			expect(suggest("\\alpha")).toEqual(["\\alpha"]);
			expect(suggest("\\sqrt")).toEqual(["\\sqrt"]);
		});

		it("completes a command prefix", () => {
			const { suggest } = createSuggester();

			expect(suggest("\\alp")).toEqual(["\\alpha"]);
			expect(suggest("\\inft")).toEqual(["\\infty"]);
		});

		it("ranks the closest match first among symbols containing the command", () => {
			const { suggest } = createSuggester();

			expect(suggest("\\frac")).toEqual([
				"\\frac{☚}{☚}☚",
				"\\cfrac{☚}{☚}☚",
				"\\dfrac{☚}{☚}☚",
				"\\tfrac{☚}{☚}☚",
				"\\genfrac",
			]);
		});

		it("suggests only symbols containing the typed command", () => {
			const { suggest } = createSuggester();

			const results = suggest("\\al");

			expect(results).toEqual(expect.arrayContaining(["\\alpha", "\\aleph", "\\maltese"]));
			expect(results.every((symbol) => symbol.toLowerCase().includes("al"))).toBe(true);
		});

		it("completes the last command after other text", () => {
			const { suggest } = createSuggester();

			const results = suggest("x^2 + \\be");

			expect(results).toContain("\\beta");
			expect(results.every((symbol) => symbol.includes("be"))).toBe(true);
		});

		it("completes the command before the caret, ignoring text after it", () => {
			const { suggest } = createSuggester();

			expect(suggest("\\alp tail", 4)).toEqual(["\\alpha"]);
		});

		it("returns nothing without a backslash command or for an unknown command", () => {
			const { suggest } = createSuggester();

			expect(suggest("alpha")).toEqual([]);
			expect(suggest("\\xyzzy")).toEqual([]);
		});
	});

	describe("renderSuggestion", () => {
		it("renders each symbol once and gives every row its own preview copy", () => {
			const { suggester } = createSuggester();
			const rowA = document.createElement("div");
			const rowB = document.createElement("div");

			suggester.renderSuggestion("\\alpha", rowA);
			suggester.renderSuggestion("\\alpha", rowB);

			const rendered = vi.mocked(renderMath).mock.results[0].value;
			expect(renderMath).toHaveBeenCalledTimes(1);
			expect(rowA.textContent).toBe("\\alpha");
			expect(rowA.querySelector(".math-preview")).not.toBeNull();
			expect(rowA.lastChild).not.toBe(rendered);
			expect(rowB.lastChild).not.toBe(rendered);
			expect(rowA.lastChild).not.toBe(rowB.lastChild);
		});
	});
});
