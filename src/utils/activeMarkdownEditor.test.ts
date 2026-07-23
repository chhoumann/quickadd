import { describe, expect, it, vi } from "vitest";
import type { App } from "obsidian";
import { getActiveMarkdownEditorView } from "./activeMarkdownEditor";

const appWithView = (view: unknown): App =>
	({
		workspace: {
			getActiveViewOfType: vi.fn(() => view),
		},
	}) as unknown as App;

describe("getActiveMarkdownEditorView", () => {
	it("returns null when no markdown view is active", () => {
		expect(getActiveMarkdownEditorView(appWithView(null))).toBeNull();
	});

	it("returns null for a Markdown-masquerading view without an editor (#1536)", () => {
		// Thino patches getActiveViewOfType to answer markdown lookups with a
		// view whose editor is null.
		expect(
			getActiveMarkdownEditorView(appWithView({ editor: null })),
		).toBeNull();
	});

	it("returns the view when it has an editor", () => {
		const view = { editor: { getSelection: () => "" } };
		expect(getActiveMarkdownEditorView(appWithView(view))).toBe(view);
	});
});
