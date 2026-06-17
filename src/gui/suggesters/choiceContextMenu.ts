import type { App, Editor, MenuPositionDef } from "obsidian";
import { Menu, MarkdownView } from "obsidian";
import type { IChoiceExecutor } from "../../IChoiceExecutor";
import type QuickAdd from "../../main";
import type IChoice from "../../types/choices/IChoice";
import type IMultiChoice from "../../types/choices/IMultiChoice";
import { log } from "../../logger/logManager";
import { resolveChoiceIcon } from "../../utils/choiceUtils";

type ContextMenuLevel = {
	label: string;
	choices: IChoice[];
};

type ContextMenuOptions = {
	choiceExecutor: IChoiceExecutor;
	position?: MenuPositionDef | null;
};

type CodeMirrorViewLike = {
	coordsAtPos?: (pos: number) => { left: number; right: number; top: number; bottom: number } | null;
	state?: { selection?: { main?: { head?: number } } };
};

type EditorWithCodeMirror = Editor & {
	cm?: CodeMirrorViewLike;
};

const CURSOR_SELECTORS = [
	".workspace-leaf.mod-active .markdown-source-view.mod-cm6 .cm-cursor-primary",
	".workspace-leaf.mod-active .cm-cursor-primary",
	".cm-editor.cm-focused .cm-cursor-primary",
	".cm-cursor-primary",
	".cm-cursor",
].join(", ");

export function openMultiChoiceContextMenu(
	plugin: QuickAdd,
	multiChoice: IMultiChoice,
	options: ContextMenuOptions,
): boolean {
	const position = options.position ?? getEditorCaretMenuPosition(plugin.app);
	if (!position) return false;

	showChoiceMenu({
		choiceExecutor: options.choiceExecutor,
		position,
		current: { label: multiChoice.name, choices: multiChoice.choices },
		stack: [],
	});
	return true;
}

export function getEditorCaretMenuPosition(app: App): MenuPositionDef | null {
	const editor =
		app.workspace.activeEditor?.editor ??
		app.workspace.getActiveViewOfType(MarkdownView)?.editor;
	const positionFromEditor = editor ? getPositionFromEditor(editor) : null;
	return positionFromEditor ?? getPositionFromCursorElement();
}

function getPositionFromEditor(editor: Editor): MenuPositionDef | null {
	const editorWithCodeMirror = editor as EditorWithCodeMirror;
	const cm = editorWithCodeMirror.cm;
	if (!cm?.coordsAtPos) return null;

	const offset = getCursorOffset(editorWithCodeMirror, cm);
	if (typeof offset !== "number") return null;

	const coords = cm.coordsAtPos(offset);
	if (!coords) return null;

	return positionFromRect(coords);
}

function getCursorOffset(
	editor: EditorWithCodeMirror,
	cm: CodeMirrorViewLike,
): number | null {
	const selectionHead = cm.state?.selection?.main?.head;
	if (typeof selectionHead === "number") return selectionHead;

	try {
		return editor.posToOffset(editor.getCursor());
	} catch {
		return null;
	}
}

function getPositionFromCursorElement(): MenuPositionDef | null {
	const cursor = document.querySelector(CURSOR_SELECTORS);
	if (!(cursor instanceof HTMLElement)) return null;

	const rect = cursor.getBoundingClientRect();
	if (rect.width === 0 && rect.height === 0) return null;

	return positionFromRect(rect);
}

function positionFromRect(rect: {
	left: number;
	right?: number;
	top: number;
	bottom: number;
}): MenuPositionDef {
	return {
		x: rect.left,
		y: rect.bottom,
	};
}

function showChoiceMenu(options: {
		choiceExecutor: IChoiceExecutor;
		position: MenuPositionDef;
		current: ContextMenuLevel;
		stack: ContextMenuLevel[];
}): void {
	const menu = new Menu().setUseNativeMenu(false);

	if (options.stack.length > 0) {
		const previous = options.stack[options.stack.length - 1];
		menu.addItem((item) =>
			item
				.setTitle(`← ${previous.label}`)
				.setIcon("arrow-left")
				.onClick(() => {
					showChoiceMenu({
						...options,
						current: previous,
						stack: options.stack.slice(0, -1),
					});
				}),
		);
		menu.addSeparator();
	}

	if (options.current.choices.length === 0) {
		menu.addItem((item) =>
			item.setTitle("No choices in this Multi").setIcon("folder").setDisabled(true),
		);
		menu.showAtPosition(options.position);
		return;
	}

	for (const choice of options.current.choices) {
		if (choice.type === "Multi") {
			menu.addItem((item) =>
				item
					.setTitle(`${choice.name} ›`)
					.setIcon(resolveChoiceIcon(choice))
					.onClick(() => {
						showChoiceMenu({
							...options,
							current: {
								label: choice.name,
								choices: (choice as IMultiChoice).choices,
							},
							stack: [...options.stack, options.current],
						});
					}),
			);
			continue;
		}

		menu.addItem((item) =>
			item
				.setTitle(choice.name)
				.setIcon(resolveChoiceIcon(choice))
				.onClick(() => {
					void options.choiceExecutor.execute(choice).catch((error) => {
						log.logError(`Failed to execute selected choice: ${error}`);
					});
				}),
		);
	}

	menu.showAtPosition(options.position);
}
