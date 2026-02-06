import { describe, expect, it, vi } from "vitest";
import { GenericTextSuggester } from "./genericTextSuggester";

describe("GenericTextSuggester", () => {
	describe("renderSuggestion", () => {
		it("normalizes the query when typing a partial .md extension so highlights still match", () => {
			const el = document.createElement("div");
			const renderMatch = vi.fn();

			GenericTextSuggester.prototype.renderSuggestion.call(
				{
					getCurrentQuery: () => "note.m",
					renderMatch,
				} as any,
				"note.md",
				el,
			);

			expect(renderMatch).toHaveBeenCalledWith(el, "note", "note");
		});

		it("treats .md extension matching as case-insensitive", () => {
			const el = document.createElement("div");
			const renderMatch = vi.fn();

			GenericTextSuggester.prototype.renderSuggestion.call(
				{
					getCurrentQuery: () => "Note.M",
					renderMatch,
				} as any,
				"Note.MD",
				el,
			);

			expect(renderMatch).toHaveBeenCalledWith(el, "Note", "Note");
		});

		it("does not change query normalization for non-markdown files", () => {
			const el = document.createElement("div");
			const renderMatch = vi.fn();

			GenericTextSuggester.prototype.renderSuggestion.call(
				{
					getCurrentQuery: () => "note.j",
					renderMatch,
				} as any,
				"note.js",
				el,
			);

			expect(renderMatch).toHaveBeenCalledWith(el, "note.js", "note.j");
		});
	});
});

