import { type App, Modal, setIcon } from "obsidian";
import type { SvelteComponent } from "svelte";
import type IChoice from "../../types/choices/IChoice";
import { promptRenameChoice } from "../choiceRename";
import { withPreservedUiContext } from "../ui/preserveUiContext";
import {
	recordChoiceBuilderMount,
	recordChoiceBuilderReload,
} from "../ui/uiStateDebug";

export abstract class ChoiceBuilder extends Modal {
	private resolvePromise: (input: IChoice) => void;
	public waitForClose: Promise<IChoice>;
	abstract choice: IChoice;
	protected svelteElements: SvelteComponent[] = [];
	protected disposables: Array<() => void> = [];
	protected renderParentOverride: HTMLElement | null = null;

	protected constructor(app: App) {
		super(app);

		this.waitForClose = new Promise<IChoice>((resolve) => {
			this.resolvePromise = resolve;
		});

		this.containerEl.addClass("quickAddModal");
		recordChoiceBuilderMount();
		this.open();
	}

	protected abstract display(): unknown;

	protected reload() {
		recordChoiceBuilderReload();
		withPreservedUiContext(this.contentEl, () => {
			this.cleanupRenderScope();
			this.contentEl.empty();
			this.display();
		});
	}

	protected cleanupRenderScope(): void {
		for (const el of this.svelteElements) {
			if (el && el.$destroy) el.$destroy();
		}
		this.svelteElements = [];

		for (const dispose of this.disposables) {
			dispose();
		}
		this.disposables = [];
	}

	protected registerDisposable(dispose: () => void): void {
		this.disposables.push(dispose);
	}

	protected get renderParentEl(): HTMLElement {
		return this.renderParentOverride ?? this.contentEl;
	}

	protected renderSection(
		parent: HTMLDivElement | null,
		render: () => void,
	): void {
		if (!parent) return;
		withPreservedUiContext(parent, () => {
			parent.empty();
			const previousParent = this.renderParentOverride;
			this.renderParentOverride = parent;
			try {
				render();
			} finally {
				this.renderParentOverride = previousParent;
			}
		});
	}

	protected addCenteredChoiceNameHeader(choice: IChoice): void {
		const headerEl: HTMLHeadingElement = this.contentEl.createEl("h2", {
			cls: "choiceNameHeader",
		});
		const textEl = headerEl.createSpan({
			text: choice.name,
			cls: "choiceNameHeaderText",
		});
		const iconEl = headerEl.createSpan({
			cls: "choiceNameHeaderIcon",
			attr: { "aria-hidden": "true" },
		});
		setIcon(iconEl, "pencil");

		headerEl.addEventListener("click", async (ev) => {
			const newName = await promptRenameChoice(this.app, choice.name);
			if (!newName) return;
			choice.name = newName;
			textEl.setText(newName);
		});
	}

	onClose() {
		super.onClose();
		this.cleanupRenderScope();
		this.resolvePromise(this.choice);
	}
}
