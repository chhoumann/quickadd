import { htmlToMarkdown, type App, type MarkdownView } from "obsidian";
import { WIKI_LINK_REGEX } from "../constants";
import { log } from "../logger/logManager";
import { EditorCommandType } from "../types/macros/EditorCommands/EditorCommandType";
import type { IEditorCommand } from "../types/macros/EditorCommands/IEditorCommand";
import { getActiveMarkdownEditorView } from "../utils/activeMarkdownEditor";

/**
 * Runs one editor-command macro step against the active Markdown editor.
 *
 * Returns false, running nothing, for a type this version does not know: a
 * newer QuickAdd can write one into a data.json an older one still reads.
 */
export async function executeEditorCommand(
	app: App,
	command: IEditorCommand,
): Promise<boolean> {
	switch (command.editorCommandType) {
		case EditorCommandType.Cut:
			await cut(app);
			return true;
		case EditorCommandType.Copy:
			await copy(app);
			return true;
		case EditorCommandType.Paste:
			await paste(app);
			return true;
		case EditorCommandType.PasteWithFormat:
			await pasteWithFormat(app);
			return true;
		case EditorCommandType.SelectActiveLine:
			selectActiveLine(app);
			return true;
		case EditorCommandType.SelectLinkOnActiveLine:
			selectLinkOnActiveLine(app);
			return true;
		case EditorCommandType.MoveCursorToFileStart:
			moveCursorToFileStart(app);
			return true;
		case EditorCommandType.MoveCursorToFileEnd:
			moveCursorToFileEnd(app);
			return true;
		case EditorCommandType.MoveCursorToLineStart:
			moveCursorToLineStart(app);
			return true;
		case EditorCommandType.MoveCursorToLineEnd:
			moveCursorToLineEnd(app);
			return true;
		default:
			return unknownEditorCommand(command.editorCommandType);
	}
}

/** Compile-time exhaustiveness for the switch above. */
function unknownEditorCommand(type: never): false {
	return false;
}

function getActiveMarkdownView(app: App): MarkdownView {
	const activeView = getActiveMarkdownEditorView(app);

	if (!activeView) {
		log.logError("no active markdown editor.");
		throw new Error("no active markdown editor.");
	}

	return activeView;
}

async function cut(app: App): Promise<void> {
	const activeView = getActiveMarkdownView(app);
	const selectedText = activeView.editor.getSelection();

	if (!selectedText) {
		log.logError("nothing selected.");
		return;
	}

	await navigator.clipboard.writeText(selectedText);
	activeView.editor.replaceSelection("");
}

async function copy(app: App): Promise<void> {
	const selectedText = getActiveMarkdownView(app).editor.getSelection();
	await navigator.clipboard.writeText(selectedText);
}

async function paste(app: App): Promise<void> {
	const clipboard = await navigator.clipboard.readText();
	getActiveMarkdownView(app).editor.replaceSelection(clipboard);
}

async function pasteWithFormat(app: App): Promise<void> {
	const activeView = getActiveMarkdownView(app);
	let content = "";

	try {
		// Check if advanced clipboard API is available
		if ("read" in navigator.clipboard && navigator.clipboard.read) {
			const clipboardItems = await navigator.clipboard.read();
			let foundHtml = false;

			// Look for HTML content in clipboard
			for (const item of clipboardItems) {
				if (item.types.includes("text/html")) {
					const htmlBlob = await item.getType("text/html");
					const htmlContent = await htmlBlob.text();
					content = htmlToMarkdown(htmlContent);
					foundHtml = true;
					break;
				}
			}

			// If no HTML found, fall back to plain text
			if (!foundHtml) {
				content = await navigator.clipboard.readText();
			}
		} else {
			// Fallback for older Electron versions
			content = await navigator.clipboard.readText();
		}

		activeView.editor.replaceSelection(content);
	} catch (error) {
		// Fallback to regular text paste if formatted clipboard reading fails
		log.logWarning(`Formatted paste failed. Falling back to plain text: ${error}`);
		try {
			const textContent = await navigator.clipboard.readText();
			activeView.editor.replaceSelection(textContent);
		} catch (textError) {
			log.logError(`Failed to read clipboard text: ${textError}`);
		}
	}
}

function selectActiveLine(app: App): void {
	const { editor } = getActiveMarkdownView(app);
	const { line: lineNumber } = editor.getCursor();
	const lineLength = editor.getLine(lineNumber).length;

	editor.setSelection(
		{ line: lineNumber, ch: 0 },
		{ line: lineNumber, ch: lineLength },
	);
}

function selectLinkOnActiveLine(app: App): void {
	const { editor } = getActiveMarkdownView(app);
	const { line: lineNumber } = editor.getCursor();
	const line = editor.getLine(lineNumber);

	const match = WIKI_LINK_REGEX.exec(line);
	if (!match) {
		log.logError(`no internal link found on line ${lineNumber}.`);
		return;
	}

	const matchStart: number = match.index;
	const matchEnd: number = match[0].length + matchStart;

	editor.setSelection(
		{ line: lineNumber, ch: matchStart },
		{ line: lineNumber, ch: matchEnd },
	);
}

function moveCursorToFileStart(app: App): void {
	getActiveMarkdownView(app).editor.setCursor({ line: 0, ch: 0 });
}

function moveCursorToFileEnd(app: App): void {
	const { editor } = getActiveMarkdownView(app);
	const lastLine = editor.lastLine();
	const lineLength = editor.getLine(lastLine).length;

	editor.setCursor({ line: lastLine, ch: lineLength });
}

function moveCursorToLineStart(app: App): void {
	const { editor } = getActiveMarkdownView(app);
	const { line: lineNumber } = editor.getCursor();

	editor.setCursor({ line: lineNumber, ch: 0 });
}

function moveCursorToLineEnd(app: App): void {
	const { editor } = getActiveMarkdownView(app);
	const { line: lineNumber } = editor.getCursor();
	const lineLength = editor.getLine(lineNumber).length;

	editor.setCursor({ line: lineNumber, ch: lineLength });
}
