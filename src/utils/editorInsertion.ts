import type { App, Editor, EditorChange, EditorPosition, TFile } from "obsidian";
import { MarkdownView } from "obsidian";
import { getActiveMarkdownEditorView } from "./activeMarkdownEditor";
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
import { processNoteFrontMatter } from "./noteContent";
import { appendLinkLineToNote } from "./fileLinks";
import type { CapturePlacementResult } from "./capturePlacement";
import type { EditorCursorPlacement, EditorTextMutationObserver } from "./editorCursorPlacement";
import { toLF } from "./toLF";

export function insertCaptureInEditor(
	payload: CapturePlacementResult,
	app: App,
	file: TFile,
	action: string,
): EditorCursorPlacement | null {
	const view = getMarkdownEditorViewForFile(app, file);
	if (!view) return null;
	return insertCaptureInBoundEditor(payload, view.editor, action);
}

export function insertCaptureInBoundEditor(
	payload: CapturePlacementResult,
	editor: Editor,
	action: string,
): EditorCursorPlacement | null {
	if (payload.cursor.kind === "none") return null;
	const content = toLF(payload.content);
	const cursorOffset = toLF(payload.content.slice(0, payload.cursor.value)).length;
	const at = (pos: EditorPosition) => editor.posToOffset(pos);
	const cursor = editor.getCursor();
	let edits: { from: EditorPosition; to?: EditorPosition; text: string; cursor: number }[];
	if (action === "currentLine") {
		edits = editor.listSelections().map(({ anchor, head }) => ({
			from: at(anchor) <= at(head) ? anchor : head,
			to: at(anchor) <= at(head) ? head : anchor,
			text: content,
			cursor: cursorOffset,
		}));
	} else if (action === "newLineAbove" || action === "newLineBelow") {
		const above = action === "newLineAbove";
		edits = [{
			from: { line: cursor.line, ch: above ? 0 : editor.getLine(cursor.line).length },
			text: above ? content + "\n" : "\n" + content,
			cursor: cursorOffset + (above ? 0 : 1),
		}];
	} else {
		return null;
	}
	const offsets: number[] = [];
	const insertionEnds: number[] = [];
	let delta = 0;
	edits.sort((a, b) => at(a.from) - at(b.from));
	for (const edit of edits) {
		offsets.push(at(edit.from) + delta + edit.cursor);
		insertionEnds.push(at(edit.from) + delta + edit.text.length - (action === "newLineAbove" ? 1 : 0));
		delta += edit.text.length - (at(edit.to ?? edit.from) - at(edit.from));
	}
	editor.transaction({ changes: edits.map(({ from, to, text }) => ({ from, to, text })) });
	editor.setSelections(insertionEnds.map(offset => ({ anchor: editor.offsetToPos(offset) })));
	return { offsets, content: editor.getValue() };
}

/**
 * Returns the active markdown view if it is showing the given file,
 * meaning its editor can be used to insert at the cursor.
 */
export function getMarkdownEditorViewForFile(
	app: App,
	file: TFile,
): MarkdownView | null {
	const view = getActiveMarkdownEditorView(app);
	if (view?.file?.path === file.path) return view;
	return null;
}

/**
 * @returns false if the active Markdown editor does not show `file` or the
 * insertion threw. Callers that report outcomes must check it.
 */
export function appendToCurrentLine(toAppend: string, app: App, file: TFile): boolean {
	try {
		const activeView = getMarkdownEditorViewForFile(app, file);

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

/** @returns true if inserted, false if the active Markdown editor does not show `file` (or it threw). */
export function insertOnNewLine(toInsert: string, direction: "above" | "below", app: App, file: TFile): boolean {
	try {
		const activeView = getMarkdownEditorViewForFile(app, file);

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
			editor.replaceRange(toInsert + "\n", { line: lineNumber, ch: 0 });
			editor.setCursor({ line: lineNumber + insertedLineCount - 1, ch: lastInsertedLineLength });
		} else {
			const currentLine = editor.getLine(lineNumber);
			editor.replaceRange("\n" + toInsert, { line: lineNumber, ch: currentLine.length });
			editor.setCursor({ line: lineNumber + insertedLineCount, ch: lastInsertedLineLength });
		}
		return true;
	} catch {
		log.logError(`unable to insert '${toInsert}' on new line ${direction}.`);
		return false;
	}
}

export function insertOnNewLineAbove(toInsert: string, app: App, file: TFile): boolean {
	return insertOnNewLine(toInsert, "above", app, file);
}

export function insertOnNewLineBelow(toInsert: string, app: App, file: TFile): boolean {
	return insertOnNewLine(toInsert, "below", app, file);
}

/**
 * Applies one text per selection in a single transaction (one undo step).
 * replaceSelection collapses each cursor after its text, since CodeMirror's
 * default mapping would leave it selected for the next keystroke to destroy.
 */
function insertPerSelection(
	editor: Editor,
	selections: { anchor: EditorPosition; head: EditorPosition }[],
	mode: "replaceSelection" | "afterSelection",
	textForSelection: (selectedText: string) => string,
	applyChanges: (changes: EditorChange[], apply: () => void) => void,
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

	applyChanges(changes, () => editor.transaction({ changes }));

	if (mode === "replaceSelection") {
		editor.setSelections(
			cursorOffsets.map((offset) => ({
				anchor: editor.offsetToPos(offset),
			})),
		);
	}
}

/**
 * Inserts text in the active Markdown editor at the chosen placement, across
 * all cursors, as a single CodeMirror transaction.
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
		onEditorTextMutation?: EditorTextMutationObserver;
	} = {},
): Promise<void> {
	const {
		requireActiveView = true,
		frontmatterProperty,
		frontmatterHandling = DEFAULT_FRONTMATTER_HANDLING,
		textForSelection,
		onEditorTextMutation,
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

		await processNoteFrontMatter(app, file, (frontmatter) => {
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
	// Editor-less Markdown-masquerading views (e.g. Thino's) support the
	// frontmatter placement above, but no text placement.
	if (!editor) {
		const message = "Cannot append link because the active Markdown view has no editor.";
		if (requireActiveView) {
			throw new Error(message);
		}
		log.logMessage(message);
		return;
	}

	const applyChanges = (changes: EditorChange[], apply: () => void) => {
		if (!onEditorTextMutation) { apply(); return; }
		const before = editor.getValue();
		const edits = changes.map(change => ({
			from: editor.posToOffset(change.from),
			to: editor.posToOffset(change.to ?? change.from),
			text: change.text,
		}));
		apply();
		onEditorTextMutation({ filePath: view.file?.path ?? null, before, after: editor.getValue(), edits });
	};

	// Snapshot current selections *before* mutating the document.
	// We copy them because CodeMirror mutates the objects in-place.
	const selections = editor
		.listSelections()
		.map((sel) => ({
			anchor: { ...sel.anchor },
			head: { ...sel.head },
		}));

	if (
		textForSelection &&
		selections.length > 0 &&
		(mode === "replaceSelection" || mode === "afterSelection")
	) {
		insertPerSelection(editor, selections, mode, textForSelection, applyChanges);
		return;
	}

	if (mode === "replaceSelection") {
		const changes = selections.map(({ anchor, head }) => ({
			from: editor.posToOffset(anchor) <= editor.posToOffset(head) ? anchor : head,
			to: editor.posToOffset(anchor) <= editor.posToOffset(head) ? head : anchor,
			text,
		}));
		applyChanges(changes, () => editor.replaceSelection(text));
		return;
	}


	// Bottom-to-top, so earlier positions stay valid while inserting.
	const asIndex = ({ line, ch }: { line: number; ch: number; }) =>
		editor.posToOffset({ line, ch });

	const ordered = selections.sort(
		(a, b) => asIndex(b.head) - asIndex(a.head),
	);

	for (const sel of ordered) {
		const head =
			asIndex(sel.anchor) > asIndex(sel.head) ? sel.anchor : sel.head;

		switch (mode) {
			case "afterSelection": {
				applyChanges([{ from: head, text }], () => editor.replaceRange(text, head));
				break;
			}

			case "endOfLine":
			case "newLine": {
				const lineLength = editor.getLine(head.line).length;
				const prefix = mode === "newLine" && lineLength > 0 ? "\n" : "";
				const from = { line: head.line, ch: lineLength };
				applyChanges([{ from, text: prefix + text }], () => editor.replaceRange(prefix + text, from));
				break;
			}
		}
	}
}

/**
 * Inserts a link to `file` into `currentNote`, the run's current note,
 * respecting Obsidian's "New link format" setting. When the active editor shows
 * that note the link lands at the configured placement; otherwise it is written
 * through the vault, into the frontmatter property or as a new last line.
 */
export async function insertFileLinkToCurrentNote(
	app: App,
	file: TFile,
	currentNote: TFile | null,
	linkOptions: AppendLinkOptions,
	onEditorTextMutation?: EditorTextMutationObserver,
	/** Write a text-placement link through the vault when no editor shows the note (a note named with `current=`). */
	writeThroughVault = false,
): Promise<boolean> {
	if (!linkOptions?.enabled) return false;

	// Re-normalizing here is idempotent for the engine callers and guarantees
	// the cross-field sanitization (linkType, displayText) cannot be bypassed
	// by raw options from scripts or third-party callers.
	const normalized = normalizeAppendLinkOptions(linkOptions);

	if (!currentNote || currentNote.extension !== "md") {
		// Read the guard from the RAW options: normalization defaults a missing
		// requireActiveFile to true, which would turn a raw caller's previous
		// silent skip into a throw.
		if (linkOptions.requireActiveFile) {
			throw new Error("Cannot append link because no active Markdown view is available.");
		}
		return false;
	}

	const sourcePath = currentNote.path;
	const linkText = buildFileLinkText(app, file, {
		sourcePath,
		linkType: normalized.linkType,
		placement: normalized.placement,
	});

	if (!getMarkdownEditorViewForFile(app, currentNote)) {
		if (normalized.placement === "inFrontmatter") {
			await processNoteFrontMatter(app, currentNote, (frontmatter) => {
				appendConfiguredFrontmatterPropertyLinkValue(
					frontmatter,
					normalized.frontmatterProperty ?? "",
					linkText,
					normalized.frontmatterHandling,
				);
			});
		} else if (writeThroughVault) {
			await appendLinkLineToNote(app, currentNote, linkText, onEditorTextMutation);
		} else {
			if (linkOptions.requireActiveFile) {
				throw new Error("Cannot append link because no active Markdown view is available.");
			}
			return false;
		}
		return true;
	}

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
			onEditorTextMutation,
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
	return setMarkdownCursorsAtOffsets(app, file, [offset], expectedContent);
}

export function setMarkdownCursorsAtOffsets(
	app: App,
	file: TFile,
	offsets: readonly number[],
	expectedContent: string,
): boolean {
	try {
		if (file.extension !== "md") return false;
		if (!offsets.length || offsets.some(offset => !Number.isSafeInteger(offset) || offset < 0 || offset > expectedContent.length)) return false;

		const view = app.workspace.getActiveViewOfType(MarkdownView);
		if (!view || view.file?.path !== file.path) return false;
		if (view.getMode() === "preview") return false;

		const editor = view.editor;
		if (!editor) return false;
		const content = editor.getValue();
		let editorOffsets = offsets;
		if (content !== expectedContent) {
			if (content !== toLF(expectedContent)) return false;
			editorOffsets = offsets.map(offset => toLF(expectedContent.slice(0, offset)).length);
		}

		if (editorOffsets.length === 1) editor.setCursor(editor.offsetToPos(editorOffsets[0]));
		else editor.setSelections(editorOffsets.map(offset => ({ anchor: editor.offsetToPos(offset) })));
		const document = view.containerEl?.ownerDocument;
		if (document && document.activeElement === document.body) editor.focus();
		return true;
	} catch {
		log.logMessage(
			`Unable to place cursor after capture in '${file.path}'.`,
		);
		return false;
	}
}
