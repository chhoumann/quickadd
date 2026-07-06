import type { App, Editor, EditorPosition, TFile } from "obsidian";
import { MarkdownView } from "obsidian";
import { log } from "../logger/logManager";
import {
	DEFAULT_FRONTMATTER_HANDLING,
	normalizeAppendLinkOptions,
	type AppendLinkOptions,
	type FrontmatterHandling,
	type LinkPlacement,
} from "../types/linkPlacement";
import { buildFileLinkText } from "./fileLinks";
import { appendConfiguredFrontmatterPropertyLinkValue } from "./frontmatterPropertyLinks";

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
 * Applies one text per selection in a single atomic transaction (one undo
 * step). replaceSelection collapses each cursor after its inserted text —
 * matching editor.replaceSelection — because CodeMirror's default change
 * mapping would otherwise leave the inserted text selected and the next
 * keystroke would destroy it. afterSelection keeps the default mapping,
 * matching the plain replaceRange path.
 */
function insertPerSelection(
	editor: Editor,
	selections: { anchor: EditorPosition; head: EditorPosition }[],
	mode: "replaceSelection" | "afterSelection",
	textForSelection: (selectedText: string) => string,
): void {
	const asIndex = (pos: EditorPosition) => editor.posToOffset(pos);

	// Pre-edit coordinates, ordered top-to-bottom so post-edit cursor offsets
	// can be computed by accumulating each earlier change's length delta.
	const edits = selections
		.map((sel) => {
			const [from, to] =
				asIndex(sel.anchor) <= asIndex(sel.head)
					? [sel.anchor, sel.head]
					: [sel.head, sel.anchor];
			return { from, to, text: textForSelection(editor.getRange(from, to)) };
		})
		.sort((a, b) => asIndex(a.from) - asIndex(b.from));

	const changes = edits.map(({ from, to, text }) =>
		mode === "replaceSelection" ? { from, to, text } : { from: to, text },
	);

	// Post-edit cursor offsets must be derived from pre-edit offsets BEFORE
	// the transaction mutates the document.
	const cursorOffsets: number[] = [];
	if (mode === "replaceSelection") {
		let delta = 0;
		for (const { from, to, text } of edits) {
			cursorOffsets.push(asIndex(from) + delta + text.length);
			delta += text.length - (asIndex(to) - asIndex(from));
		}
	}

	editor.transaction({ changes });

	if (mode === "replaceSelection") {
		editor.setSelections(
			cursorOffsets.map((offset) => ({
				anchor: editor.offsetToPos(offset),
			})),
		);
	}
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
export async function insertLinkWithPlacement(
	app: App,
	text: string,
	mode: LinkPlacement = "replaceSelection",
	options: {
		requireActiveView?: boolean;
		frontmatterProperty?: string;
		frontmatterHandling?: FrontmatterHandling;
		/**
		 * When set, the selection-anchored placements (replaceSelection,
		 * afterSelection) derive the inserted text per selection from that
		 * selection's own text (e.g. to keep it as the link's display alias).
		 * Other placements ignore it and insert `text`.
		 */
		textForSelection?: (selectedText: string) => string;
	} = {},
): Promise<void> {
	const {
		requireActiveView = true,
		frontmatterProperty,
		frontmatterHandling = DEFAULT_FRONTMATTER_HANDLING,
		textForSelection,
	} = options;
	const view = app.workspace.getActiveViewOfType(MarkdownView);
	if (!view) {
		const message = "Cannot append link because no active Markdown view is available.";
		if (requireActiveView) {
			throw new Error(message);
		}
		log.logMessage(message);
		return;
	}

	if (mode === "inFrontmatter") {
		const file = view.file;
		if (!file) {
			throw new Error("Cannot append link because the active Markdown view has no file.");
		}

		await app.fileManager.processFrontMatter(file, (frontmatter) => {
			appendConfiguredFrontmatterPropertyLinkValue(
				frontmatter,
				frontmatterProperty ?? "",
				text,
				frontmatterHandling,
			);
		});
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
	//  SELECTION-ANCHORED MODES WITH PER-SELECTION TEXT
	//////////////////////////////////////////////////////////////////
	if (
		textForSelection &&
		selections.length > 0 &&
		(mode === "replaceSelection" || mode === "afterSelection")
	) {
		insertPerSelection(editor, selections, mode, textForSelection);
		return;
	}

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
export async function insertFileLinkToActiveView(
	app: App,
	file: TFile,
	linkOptions: AppendLinkOptions,
): Promise<boolean> {
	if (!linkOptions?.enabled) return false;

	// Re-normalizing here is idempotent for the engine callers and guarantees
	// the cross-field sanitization (linkType, displayText) cannot be bypassed
	// by raw options from scripts or third-party callers.
	const normalized = normalizeAppendLinkOptions(linkOptions);

	const view = app.workspace.getActiveViewOfType(MarkdownView);
	if (!view || !view.file) {
		// Read the guard from the RAW options: normalization defaults a missing
		// requireActiveFile to true, which would turn a raw caller's previous
		// silent skip into a throw.
		if (linkOptions.requireActiveFile) {
			throw new Error("Cannot append link because no active Markdown view is available.");
		}
		return false;
	}

	const sourcePath = view.file.path;
	const linkText = buildFileLinkText(app, file, {
		sourcePath,
		linkType: normalized.linkType,
		placement: normalized.placement,
	});

	// Normalization guarantees "selection" only for selection-anchored
	// placements with a plain link into the active note.
	const textForSelection =
		normalized.displayText === "selection"
			? (selectedText: string) =>
					buildFileLinkText(app, file, {
						sourcePath,
						linkType: normalized.linkType,
						placement: normalized.placement,
						alias: selectedText,
					})
			: undefined;

	await insertLinkWithPlacement(
		app,
		linkText,
		normalized.placement,
		{
			requireActiveView: false,
			frontmatterProperty: normalized.frontmatterProperty,
			frontmatterHandling: normalized.frontmatterHandling,
			textForSelection,
		},
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
