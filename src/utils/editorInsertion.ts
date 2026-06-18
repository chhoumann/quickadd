import type { App, TFile } from "obsidian";
import { MarkdownView } from "obsidian";
import { log } from "../logger/logManager";
import type { AppendLinkOptions, LinkPlacement } from "../types/linkPlacement";
import { buildFileLinkText } from "./fileLinks";

/**
 * Returns the active markdown view if it is showing the given file,
 * meaning its editor can be used to insert at the cursor.
 */
export function getMarkdownEditorViewForFile(
	app: App,
	file: TFile,
): MarkdownView | null {
	const view = app.workspace.getActiveViewOfType(MarkdownView);
	if (view?.file?.path === file.path) return view;
	return null;
}

/**
 * @returns true if the text was inserted, false if there was no active Markdown
 * editor to insert into (or insertion threw). Callers that need to know whether
 * the capture actually landed (e.g. the URI x-callback handler) must check this.
 */
export function appendToCurrentLine(toAppend: string, app: App): boolean {
	try {
		const activeView = app.workspace.getActiveViewOfType(MarkdownView);

		if (!activeView) {
			log.logError(`unable to append '${toAppend}' to current line.`);
			return false;
		}

		activeView.editor.replaceSelection(toAppend);
		return true;
	} catch {
		log.logError(`unable to append '${toAppend}' to current line.`);
		return false;
	}
}

/** @returns true if inserted, false if no active Markdown editor (or it threw). */
export function insertOnNewLine(toInsert: string, direction: "above" | "below", app: App): boolean {
	try {
		const activeView = app.workspace.getActiveViewOfType(MarkdownView);

		if (!activeView) {
			log.logError(`unable to insert '${toInsert}' on new line ${direction}.`);
			return false;
		}

		const editor = activeView.editor;
		const cursor = editor.getCursor();
		const lineNumber = cursor.line;
		const insertedLines = toInsert.split("\n");
		const insertedLineCount = insertedLines.length;
		const lastInsertedLineLength =
			insertedLines[insertedLineCount - 1]?.length ?? 0;
		if (direction === "above") {
			// Insert at the beginning of the current line, add content + newline
			editor.replaceRange(toInsert + "\n", { line: lineNumber, ch: 0 });
			// Move cursor to end of inserted content (before the newline)
			editor.setCursor({ line: lineNumber + insertedLineCount - 1, ch: lastInsertedLineLength });
		} else {
			// Insert at the end of the current line, add newline + content
			const currentLine = editor.getLine(lineNumber);
			editor.replaceRange("\n" + toInsert, { line: lineNumber, ch: currentLine.length });
			// Move cursor to end of inserted content
			editor.setCursor({ line: lineNumber + insertedLineCount, ch: lastInsertedLineLength });
		}
		return true;
	} catch {
		log.logError(`unable to insert '${toInsert}' on new line ${direction}.`);
		return false;
	}
}

export function insertOnNewLineAbove(toInsert: string, app: App): boolean {
	return insertOnNewLine(toInsert, "above", app);
}

export function insertOnNewLineBelow(toInsert: string, app: App): boolean {
	return insertOnNewLine(toInsert, "below", app);
}

/**
 * Core routine that inserts a link (or any text) in the active markdown
 * editor according to the chosen placement mode.
 *
 * – Works with any number of cursors / selections.
 * – Falls back gracefully if no markdown editor is focused.
 * – Keeps the editor's undo history clean by performing a single
 *   CodeMirror transaction.
 */
export function insertLinkWithPlacement(
	app: App,
	text: string,
	mode: LinkPlacement = "replaceSelection",
	options: { requireActiveView?: boolean; } = {},
) {
	const { requireActiveView = true } = options;
	const view = app.workspace.getActiveViewOfType(MarkdownView);
	if (!view) {
		const message = "Cannot append link because no active Markdown view is available.";
		if (requireActiveView) {
			throw new Error(message);
		}
		log.logMessage(message);
		return;
	}

	const editor = view.editor;

	// Snapshot current selections *before* mutating the document.
	// We copy them because CodeMirror mutates the objects in-place.
	const selections = editor
		.listSelections()
		.map((sel) => ({
			anchor: { ...sel.anchor },
			head: { ...sel.head },
		}));

	//////////////////////////////////////////////////////////////////
	//  REPLACE-SELECTION
	//////////////////////////////////////////////////////////////////
	if (mode === "replaceSelection") {
		editor.replaceSelection(text);
		return;
	}

	//////////////////////////////////////////////////////////////////
	//  ALL OTHER MODES NEED EXPLICIT POSITION CALCULATION
	//////////////////////////////////////////////////////////////////

	/**
		* Helper that converts a {line, ch} position to a monotonically
		* increasing index so we can sort selections bottom-to-top.
		* Sorting bottom-to-top prevents indices from becoming stale while
		* we insert (because later lines are modified first).
		*/
	const asIndex = ({ line, ch }: { line: number; ch: number; }) =>
		editor.posToOffset({ line, ch });

	// Sort selections by document position (descending)
	const ordered = selections.sort(
		(a, b) => asIndex(b.head) - asIndex(a.head),
	);

	// Perform all insertions sequentially for simplicity
	for (const sel of ordered) {
		const head =
			asIndex(sel.anchor) > asIndex(sel.head) ? sel.anchor : sel.head;

		switch (mode) {
			//////////////////////////////////////////////////////////////////
			//  AFTER-SELECTION
			//////////////////////////////////////////////////////////////////
			case "afterSelection": {
				editor.replaceRange(text, head);
				break;
			}

			//////////////////////////////////////////////////////////////////
			//  END-OF-LINE
			//////////////////////////////////////////////////////////////////
			case "endOfLine": {
				const lineStr = editor.getLine(head.line);
				const eolPos = { line: head.line, ch: lineStr.length };
				editor.replaceRange(text, eolPos);
				break;
			}

			//////////////////////////////////////////////////////////////////
			//  NEW-LINE
			//////////////////////////////////////////////////////////////////
			case "newLine": {
				const lineStr = editor.getLine(head.line);
				const eolPos = { line: head.line, ch: lineStr.length };
				// prepend newline only if the current line isn't empty
				const isLineEmpty = lineStr.length === 0;
				const prefix = isLineEmpty ? "" : "\n";
				editor.replaceRange(prefix + text, eolPos);
				break;
			}
		}
	}
}

/**
 * Inserts a link to the specified file into the active view, respecting
 * Obsidian's "New link format" setting.
 *
 * @param app - The Obsidian app instance
 * @param file - The file to link to
 * @param linkOptions - Options controlling link insertion behavior
 * @returns True if the link was inserted, false otherwise
 */
export function insertFileLinkToActiveView(
	app: App,
	file: TFile,
	linkOptions: AppendLinkOptions,
): boolean {
	if (!linkOptions?.enabled) return false;

	const activeFile = app.workspace.getActiveFile();
	if (!activeFile && linkOptions.requireActiveFile) {
		throw new Error("Append link is enabled but there's no active file to insert into.");
	}

	const view = app.workspace.getActiveViewOfType(MarkdownView);
	if (!view) {
		if (linkOptions.requireActiveFile) {
			throw new Error("Cannot append link because no active Markdown view is available.");
		}
		return false;
	}

	const sourcePath = activeFile?.path ?? "";
	const linkText = buildFileLinkText(app, file, {
		sourcePath,
		linkType: linkOptions.linkType,
		placement: linkOptions.placement,
	});

	insertLinkWithPlacement(
		app,
		linkText,
		linkOptions.placement,
		{ requireActiveView: false },
	);

	return true;
}

export function setMarkdownCursorAtOffset(
	app: App,
	file: TFile,
	offset: number,
	expectedContent: string,
): boolean {
	try {
		if (file.extension !== "md") return false;
		if (!Number.isSafeInteger(offset) || offset < 0) return false;
		if (offset > expectedContent.length) return false;

		const view = app.workspace.getActiveViewOfType(MarkdownView);
		if (!view || view.file?.path !== file.path) return false;
		if (view.getMode() === "preview") return false;

		const editor = view.editor;
		if (!editor || editor.getValue() !== expectedContent) return false;

		editor.setCursor(editor.offsetToPos(offset));
		return true;
	} catch {
		log.logMessage(
			`Unable to place cursor after capture in '${file.path}'.`,
		);
		return false;
	}
}
