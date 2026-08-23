import {
	ButtonComponent,
	Notice,
	Platform,
	Scope,
	debounce,
	setIcon,
} from "obsidian";
import type { App } from "obsidian";
import { getActiveEditorSelection } from "../../utils/activeMarkdownEditor";
import { createOwnedElement } from "../../utils/activeWindow";
import {
	PEEK_SHORTCUT_KEY,
	peekReturnHint,
} from "../promptShortcuts";
import { previewSelection } from "./peekText";
import { hasVisiblePrompt } from "./visiblePrompts";

export type PromptPeekHandle = {
	title: string;
	resume: () => void;
	cancel: () => void;
	insertSelectionAndResume: (selection: string) => void;
};

type SelectionListener = (() => void) & { cancel?: () => void };

/**
 * One live peek. Hiding the prompt without settling parks the run here until
 * the user returns, inserts a selection, or cancels.
 */
export class PromptPeekSession {
	private static active: PromptPeekSession | null = null;

	private chipEl: HTMLElement | null = null;
	private insertButton: ButtonComponent | null = null;
	private compactChrome = false;
	private returnScope: Scope | null = null;
	private selectionDocuments: Document[] = [];
	private selectionListener: SelectionListener | null = null;
	private chipKeyListener: ((evt: KeyboardEvent) => void) | null = null;
	private hasSelection: boolean | null = null;
	private selectionPreview = "";

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
		const displaced = PromptPeekSession.active;
		if (displaced) {
			// Only one run can be parked. Cancelling the old one settles its
			// promise; silently discarding it would leave that run awaiting
			// its prompt forever.
			const title = displaced.handle.title;
			displaced.cancel();
			new Notice(`QuickAdd: cancelled the peeked prompt "${title}".`);
		}
		const session = new PromptPeekSession(app, handle);
		PromptPeekSession.active = session;
		session.mount();
		return session;
	}

	static discard(): void {
		PromptPeekSession.active?.destroy();
	}

	/** Tear down the chip without settling; for hosts that already settled. */
	discard(): void {
		this.destroy();
	}

	resume(): void {
		if (!this.canReturnNow()) return;
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
		if (!this.canReturnNow()) return;
		const selection = getActiveEditorSelection(this.app);
		if (!selection) {
			this.resume();
			return;
		}
		const handle = this.handle;
		this.destroy();
		handle.insertSelectionAndResume(selection);
	}

	/** Another visible prompt would end up stacked under the resumed one. */
	private canReturnNow(): boolean {
		if (!hasVisiblePrompt()) return true;
		new Notice(
			"QuickAdd: close the open prompt before returning to the peeked one.",
		);
		return false;
	}

	private mount(): void {
		const workspace = this.app.workspace as { containerEl?: HTMLElement };
		const ownerDocument = workspace.containerEl?.ownerDocument ?? document;
		// Body, not the workspace leaf: `position: fixed` inside a transformed
		// modal ancestor parks the chip at the top of the pane.
		const owner = ownerDocument.body;
		this.compactChrome = Platform.isPhone;

		const chip = owner.createDiv({ cls: "qa-peek-chip" });
		chip.setAttribute("role", "status");
		chip.setAttribute("aria-live", "polite");
		if (this.compactChrome) {
			// Top, not bottom: the iOS home indicator and Obsidian's
			// .mobile-navbar share the bottom inset.
			chip.addClass("qa-peek-chip--compact", "qa-peek-chip--top");
		}

		const header = chip.createDiv({ cls: "qa-peek-chip-header" });
		const icon = header.createEl("span", { cls: "qa-peek-chip-icon" });
		icon.setAttribute("aria-hidden", "true");
		setIcon(icon, "eye");
		const titles = header.createDiv({ cls: "qa-peek-chip-titles" });
		titles.createDiv({
			cls: "qa-peek-chip-title",
			text: this.compactChrome ? this.handle.title : "QuickAdd is waiting",
		});
		if (!this.compactChrome) {
			titles.createDiv({
				cls: "qa-peek-chip-subtitle",
				text: this.handle.title,
			});
			chip.createEl("p", {
				cls: "qa-peek-chip-hint",
				text: "Look at the note, copy or select text, then come back. Your draft is still there.",
			});
		}

		const actions = chip.createDiv({ cls: "qa-peek-chip-actions" });

		this.insertButton = new ButtonComponent(actions)
			.setButtonText(this.compactChrome ? "Insert" : "Insert selection")
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

		const cancel = new ButtonComponent(actions)
			.setTooltip("Discard this run")
			.onClick(() => this.cancel());
		cancel.buttonEl.addClass("qa-peek-chip-cancel");
		cancel.buttonEl.setAttribute("aria-label", "Cancel this run");
		if (this.compactChrome) {
			const cancelIcon = createOwnedElement(cancel.buttonEl, "span");
			cancelIcon.className = "qa-peek-chip-cancel-icon";
			cancelIcon.setAttribute("aria-hidden", "true");
			setIcon(cancelIcon, "x");
			cancel.buttonEl.replaceChildren(cancelIcon);
		} else {
			cancel.setButtonText("Cancel");
		}

		if (!Platform.isMobile) {
			// Windows narrower than 540px hide this line in CSS, so a live
			// resize needs no JS involvement.
			chip.createEl("p", {
				cls: "qa-peek-chip-keys",
				text: peekReturnHint(),
			});
		}

		this.chipEl = chip;
		this.refreshInsertButton();
		this.listenForSelection();
		this.listenForChipEscape();
		this.pushReturnShortcut();
	}

	private listenForSelection(): void {
		const listener = debounce(
			() => this.refreshInsertButton(),
			100,
			true,
		) as unknown as SelectionListener;
		this.selectionListener = listener;
		// Popout windows are separate documents, and selectionchange fires
		// only on the document that owns the selection.
		this.selectionDocuments = collectWorkspaceDocuments(
			this.app,
			this.chipEl?.ownerDocument ?? document,
		);
		for (const doc of this.selectionDocuments) {
			doc.addEventListener("selectionchange", listener);
		}
	}

	private refreshInsertButton(): void {
		const button = this.insertButton;
		if (!button) return;
		const selection = getActiveEditorSelection(this.app);
		const hasSelection = selection.length > 0;
		const preview =
			hasSelection && !this.compactChrome ? previewSelection(selection) : "";
		if (
			hasSelection === this.hasSelection &&
			preview === this.selectionPreview
		) {
			return;
		}
		this.hasSelection = hasSelection;
		this.selectionPreview = preview;
		button.setDisabled(!hasSelection);
		button.buttonEl.classList.toggle("qa-peek-insert-ready", hasSelection);
		if (!this.compactChrome) {
			button.setButtonText(
				hasSelection ? `Insert “${preview}”` : "Insert selection",
			);
		}
	}

	/**
	 * Escape on the chip itself is fine (focus is not in the editor). A
	 * workspace-wide Escape scope is not - Vim uses that key to leave insert.
	 */
	private listenForChipEscape(): void {
		const chip = this.chipEl;
		if (!chip) return;
		this.chipKeyListener = (evt: KeyboardEvent) => {
			if (evt.isComposing || evt.key !== "Escape") return;
			const target = evt.target;
			if (!(target instanceof Node) || !chip.contains(target)) return;
			evt.preventDefault();
			this.resume();
		};
		chip.addEventListener("keydown", this.chipKeyListener);
	}

	private pushReturnShortcut(): void {
		// Parented to the app scope so every global hotkey keeps working
		// while the user navigates; a parentless pushed scope would swallow
		// them all for the whole peek.
		this.returnScope = new Scope(this.app.scope);
		this.returnScope.register(["Mod", "Shift"], PEEK_SHORTCUT_KEY, () => {
			this.resume();
			return false;
		});
		this.app.keymap.pushScope(this.returnScope);
	}

	private destroy(): void {
		if (PromptPeekSession.active === this) {
			PromptPeekSession.active = null;
		}
		if (this.returnScope) {
			this.app.keymap.popScope(this.returnScope);
			this.returnScope = null;
		}
		if (this.chipKeyListener && this.chipEl) {
			this.chipEl.removeEventListener("keydown", this.chipKeyListener);
			this.chipKeyListener = null;
		}
		if (this.selectionListener) {
			for (const doc of this.selectionDocuments) {
				doc.removeEventListener("selectionchange", this.selectionListener);
			}
			this.selectionListener.cancel?.();
			this.selectionListener = null;
		}
		this.selectionDocuments = [];
		this.chipEl?.remove();
		this.chipEl = null;
		this.insertButton = null;
	}
}

function collectWorkspaceDocuments(app: App, fallback: Document): Document[] {
	const documents = new Set<Document>([fallback]);
	const workspace = app.workspace as {
		iterateAllLeaves?: (
			callback: (leaf: { view?: { containerEl?: HTMLElement } }) => void,
		) => void;
	};
	workspace.iterateAllLeaves?.((leaf) => {
		const doc = leaf.view?.containerEl?.ownerDocument;
		if (doc) documents.add(doc);
	});
	return [...documents];
}
