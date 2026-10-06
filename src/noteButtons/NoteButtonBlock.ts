import { MarkdownRenderChild, setIcon } from "obsidian";
import { settingsStore } from "../settingsStore";
import type IChoice from "../types/choices/IChoice";
import { resolveChoiceIcon } from "../utils/choiceUtils";
import { summarizeChoice } from "../v3/choiceSummary";
import { parseButtonBlock, resolveButtonRef } from "./buttonBlock";

type Button =
	| { choice: IChoice; label: string; icon: string; title: string }
	| { problem: string };

/**
 * A rendered quickadd block: a row of buttons that run choices. It renders
 * again when the choices change, so a renamed or deleted choice shows in the
 * open note, and stops listening when the note closes.
 */
export class NoteButtonBlock extends MarkdownRenderChild {
	private readonly running = new Set<string>();
	private renderedKey: string | null = null;
	private choiceButtons: { id: string; el: HTMLButtonElement }[] = [];

	constructor(
		containerEl: HTMLElement,
		private readonly source: string,
		private readonly run: (choice: IChoice) => Promise<void>,
	) {
		super(containerEl);
	}

	onload(): void {
		this.render();
		this.register(settingsStore.subscribe(() => this.render()));
	}

	private buttons(): Button[] {
		const choices = settingsStore.getState().choices;
		return parseButtonBlock(this.source).map((line) => {
			if ("unreadable" in line) return { problem: `Can't read '${line.unreadable}'` };
			const target = resolveButtonRef(line.ref, choices);
			if ("problem" in target) return target;
			const { choice } = target;
			return {
				choice,
				label: line.label ?? choice.name,
				icon: resolveChoiceIcon(choice),
				title: summarizeChoice(choice, choices),
			};
		});
	}

	private render(): void {
		const buttons = this.buttons();
		// Every settings change lands here; leave the buttons, and their focus, alone
		// unless what they show changed.
		const key = JSON.stringify(buttons.map((b) => ("choice" in b ? { ...b, choice: b.choice.id } : b)));
		if (key === this.renderedKey) return;
		this.renderedKey = key;

		this.containerEl.empty();
		this.choiceButtons = [];
		const row = this.containerEl.createDiv({ cls: "qa-note-buttons" });
		for (const button of buttons) {
			const el = row.createEl("button", { cls: "qa-note-button" });
			if ("problem" in button) {
				// Not is-unresolved: live preview colours that class as an unresolved link.
				el.addClass("qa-note-button--unresolved");
				el.disabled = true;
				el.createSpan({ cls: "qa-note-button-label", text: button.problem });
				continue;
			}
			setIcon(el.createSpan({ cls: "qa-note-button-icon" }), button.icon);
			el.createSpan({ cls: "qa-note-button-label", text: button.label });
			if (button.title) el.title = button.title;
			el.addEventListener("click", () => void this.runChoice(button.choice));
			this.choiceButtons.push({ id: button.choice.id, el });
		}
		this.showRunning();
	}

	/** A choice's buttons stay disabled while it runs, so a second tap cannot start it again. */
	private showRunning(): void {
		for (const { id, el } of this.choiceButtons) el.disabled = this.running.has(id);
	}

	private async runChoice(choice: IChoice): Promise<void> {
		if (this.running.has(choice.id)) return;
		this.running.add(choice.id);
		this.showRunning();
		try {
			await this.run(choice);
		} finally {
			this.running.delete(choice.id);
			this.showRunning();
		}
	}
}
