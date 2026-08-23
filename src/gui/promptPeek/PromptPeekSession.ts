import { ButtonComponent, Scope, setIcon } from "obsidian";
import type { App } from "obsidian";
import { getActiveMarkdownEditorView } from "../../utils/activeMarkdownEditor";
import { createOwnedElement } from "../../utils/activeWindow";
import { previewSelection } from "./promptPeekPhase";

export type PromptPeekHandle = {
	title: string;
	resume: () => void;
	cancel: () => void;
	insertSelectionAndResume: (selection: string) => void;
};

/**
 * One live peek. Closing the prompt without settling parks the run here until
 * the user returns, inserts a selection, or cancels.
 */
export class PromptPeekSession {
	private static active: PromptPeekSession | null = null;

	private chipEl: HTMLElement | null = null;
	private insertButton: ButtonComponent | null = null;
	private escapeScope: Scope | null = null;
	private selectionListener: (() => void) | null = null;

	private constructor(
		private readonly app: App,
		private readonly handle: PromptPeekHandle,
	) {}

	static isPeeking(): boolean {
		return PromptPeekSession.active !== null;
	}

	static getActive(): PromptPeekSession | null {
		return PromptPeekSession.active;
	}

	static activate(app: App, handle: PromptPeekHandle): PromptPeekSession {
		PromptPeekSession.active?.destroy();
		const session = new PromptPeekSession(app, handle);
		PromptPeekSession.active = session;
		session.mount();
		return session;
	}

	static discard(): void {
		PromptPeekSession.active?.destroy();
	}

	resume(): void {
		const handle = this.handle;
		this.destroy();
		handle.resume();
	}

	cancel(): void {
		const handle = this.handle;
		this.destroy();
		handle.cancel();
	}

	insertSelectionAndResume(): void {
		const selection = currentEditorSelection(this.app);
		if (!selection) {
			this.resume();
			return;
		}
		const handle = this.handle;
		this.destroy();
		handle.insertSelectionAndResume(selection);
	}

	private mount(): void {
		const workspace = this.app.workspace as { containerEl?: HTMLElement };
		const owner = workspace.containerEl ?? document.body;
		const chip = appendOwned(owner, "div", "qa-peek-chip");
		chip.setAttribute("role", "status");
		chip.setAttribute("aria-live", "polite");

		const header = appendOwned(chip, "div", "qa-peek-chip-header");
		const icon = appendOwned(header, "span", "qa-peek-chip-icon");
		icon.setAttribute("aria-hidden", "true");
		setIcon(icon, "eye");
		const titles = appendOwned(header, "div", "qa-peek-chip-titles");
		const title = appendOwned(titles, "div", "qa-peek-chip-title");
		title.textContent = "QuickAdd is waiting";
		const subtitle = appendOwned(titles, "div", "qa-peek-chip-subtitle");
		subtitle.textContent = this.handle.title;

		const hint = appendOwned(chip, "p", "qa-peek-chip-hint");
		hint.textContent =
			"Look at the note, copy or select text, then come back. Your draft is still there.";

		const actions = appendOwned(chip, "div", "qa-peek-chip-actions");

		this.insertButton = new ButtonComponent(actions)
			.setButtonText("Insert selection")
			.setCta()
			.setTooltip("Drop the selected text into your draft and return")
			.onClick(() => this.insertSelectionAndResume());
		this.insertButton.buttonEl.setAttribute(
			"aria-label",
			"Insert the selected text and return to QuickAdd",
		);

		new ButtonComponent(actions)
			.setButtonText("Return")
			.setTooltip("Go back to the prompt without inserting")
			.onClick(() => this.resume());

		new ButtonComponent(actions)
			.setButtonText("Cancel")
			.setTooltip("Discard this run")
			.onClick(() => this.cancel());

		const keys = appendOwned(chip, "p", "qa-peek-chip-keys");
		keys.textContent = "Esc returns to the prompt";

		this.chipEl = chip;
		this.refreshInsertButton();
		this.listenForSelection();
		this.pushEscapeScope();
	}

	private listenForSelection(): void {
		const ownerDocument = this.chipEl?.ownerDocument ?? document;
		this.selectionListener = () => this.refreshInsertButton();
		ownerDocument.addEventListener("selectionchange", this.selectionListener);
	}

	private refreshInsertButton(): void {
		const selection = currentEditorSelection(this.app);
		const button = this.insertButton;
		if (!button) return;
		const hasSelection = selection.length > 0;
		button.setDisabled(!hasSelection);
		button.buttonEl.classList.toggle("qa-peek-insert-ready", hasSelection);
		button.setButtonText(
			hasSelection
				? `Insert “${previewSelection(selection)}”`
				: "Insert selection",
		);
		button.buttonEl.hidden = false;
	}

	private pushEscapeScope(): void {
		this.escapeScope = new Scope();
		this.escapeScope.register([], "Escape", () => {
			this.resume();
			return false;
		});
		this.app.keymap.pushScope(this.escapeScope);
	}

	private destroy(): void {
		if (PromptPeekSession.active === this) {
			PromptPeekSession.active = null;
		}
		if (this.escapeScope) {
			this.app.keymap.popScope(this.escapeScope);
			this.escapeScope = null;
		}
		if (this.selectionListener) {
			const ownerDocument = this.chipEl?.ownerDocument ?? document;
			ownerDocument.removeEventListener(
				"selectionchange",
				this.selectionListener,
			);
			this.selectionListener = null;
		}
		this.chipEl?.remove();
		this.chipEl = null;
		this.insertButton = null;
	}
}

function currentEditorSelection(app: App): string {
	return getActiveMarkdownEditorView(app)?.editor.getSelection() ?? "";
}

function appendOwned<K extends keyof HTMLElementTagNameMap>(
	parent: Node,
	tagName: K,
	className: string,
): HTMLElementTagNameMap[K] {
	const node = createOwnedElement(parent, tagName);
	node.className = className;
	parent.appendChild(node);
	return node;
}
