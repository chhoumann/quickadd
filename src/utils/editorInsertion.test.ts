import { describe, expect, it, vi } from "vitest";
import type { App, TFile } from "obsidian";
import { setMarkdownCursorAtOffset } from "./editorInsertion";

function createHarness({
	mode = "source",
	value = "Line A\nCAPTURE\nLine B",
	path = "Target.md",
}: {
	mode?: "source" | "preview";
	value?: string;
	path?: string;
} = {}) {
	const setCursor = vi.fn();
	const offsetToPos = vi.fn((offset: number) => ({ line: 1, ch: offset }));
	const view = {
		file: { path },
		getMode: () => mode,
		editor: {
			getValue: () => value,
			offsetToPos,
			setCursor,
		},
	};
	const app = {
		workspace: {
			getActiveViewOfType: vi.fn(() => view),
		},
	} as unknown as App;
	const file = { path, extension: "md" } as TFile;

	return { app, file, offsetToPos, setCursor };
}

describe("setMarkdownCursorAtOffset", () => {
	it("sets the cursor in the active markdown editor when content matches", () => {
		const { app, file, offsetToPos, setCursor } = createHarness();

		const placed = setMarkdownCursorAtOffset(
			app,
			file,
			"Line A\nCAPTURE\n".length,
			"Line A\nCAPTURE\nLine B",
		);

		expect(placed).toBe(true);
		expect(offsetToPos).toHaveBeenCalledWith("Line A\nCAPTURE\n".length);
		expect(setCursor).toHaveBeenCalledWith({
			line: 1,
			ch: "Line A\nCAPTURE\n".length,
		});
	});

	it("skips preview mode", () => {
		const { app, file, setCursor } = createHarness({ mode: "preview" });

		const placed = setMarkdownCursorAtOffset(
			app,
			file,
			7,
			"Line A\nCAPTURE\nLine B",
		);

		expect(placed).toBe(false);
		expect(setCursor).not.toHaveBeenCalled();
	});

	it("skips when the editor buffer does not match the expected capture write", () => {
		const { app, file, setCursor } = createHarness({ value: "stale" });

		const placed = setMarkdownCursorAtOffset(
			app,
			file,
			7,
			"Line A\nCAPTURE\nLine B",
		);

		expect(placed).toBe(false);
		expect(setCursor).not.toHaveBeenCalled();
	});
});
