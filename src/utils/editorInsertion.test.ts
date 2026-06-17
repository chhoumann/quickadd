import { describe, expect, it } from "vitest";
import type { App, EditorPosition } from "obsidian";
import { appendToCurrentLine, insertOnNewLine } from "./editorInsertion";

class TextEditor {
	private value: string;
	private cursor: EditorPosition;

	constructor(value: string, cursor: EditorPosition) {
		this.value = value;
		this.cursor = { ...cursor };
	}

	getValue(): string {
		return this.value;
	}

	getCursor(): EditorPosition {
		return { ...this.cursor };
	}

	setCursor(position: EditorPosition): void {
		this.cursor = { ...position };
	}

	getLine(line: number): string {
		return this.value.split("\n")[line] ?? "";
	}

	posToOffset(position: EditorPosition): number {
		const lines = this.value.split("\n");
		let offset = 0;
		for (let line = 0; line < position.line; line++) {
			offset += (lines[line]?.length ?? 0) + 1;
		}
		return offset + position.ch;
	}

	offsetToPos(offset: number): EditorPosition {
		const bounded = Math.max(0, Math.min(offset, this.value.length));
		const before = this.value.slice(0, bounded);
		const lines = before.split("\n");
		return {
			line: lines.length - 1,
			ch: lines[lines.length - 1]?.length ?? 0,
		};
	}

	replaceSelection(text: string): void {
		const offset = this.posToOffset(this.cursor);
		this.value = `${this.value.slice(0, offset)}${text}${this.value.slice(offset)}`;
		this.cursor = this.offsetToPos(offset + text.length);
	}

	replaceRange(text: string, position: EditorPosition): void {
		const offset = this.posToOffset(position);
		this.value = `${this.value.slice(0, offset)}${text}${this.value.slice(offset)}`;
		this.cursor = this.offsetToPos(offset + text.length);
	}
}

function appWithEditor(editor: TextEditor): App {
	return {
		workspace: {
			getActiveViewOfType: () => ({ editor }),
		},
	} as unknown as App;
}

describe("editor insertion cursor preservation", () => {
	it("keeps the cursor at the capture position after current-line insertion", () => {
		const editor = new TextEditor("alpha beta", { line: 0, ch: 6 });

		const inserted = appendToCurrentLine("CAPTURED ", appWithEditor(editor));

		expect(inserted).toBe(true);
		expect(editor.getValue()).toBe("alpha CAPTURED beta");
		expect(editor.getCursor()).toEqual({ line: 0, ch: 6 });
	});

	it("keeps the cursor with the original text when inserting above", () => {
		const editor = new TextEditor("alpha\nbeta", { line: 1, ch: 2 });

		const inserted = insertOnNewLine("one\ntwo", "above", appWithEditor(editor));

		expect(inserted).toBe(true);
		expect(editor.getValue()).toBe("alpha\none\ntwo\nbeta");
		expect(editor.getCursor()).toEqual({ line: 3, ch: 2 });
	});

	it("keeps the cursor in place when inserting below the current line", () => {
		const editor = new TextEditor("alpha\nbeta", { line: 0, ch: 2 });

		const inserted = insertOnNewLine("one\ntwo", "below", appWithEditor(editor));

		expect(inserted).toBe(true);
		expect(editor.getValue()).toBe("alpha\none\ntwo\nbeta");
		expect(editor.getCursor()).toEqual({ line: 0, ch: 2 });
	});
});
