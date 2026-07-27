import { Modal, ButtonComponent } from "obsidian";
import type { App } from "obsidian";
import type QuickAdd from "../../main";
import type IChoice from "../../types/choices/IChoice";
import type { ICommand } from "../../types/macros/ICommand";
import { deepClone } from "../../utils/deepClone";
import { commandListOf } from "../../utils/macroUtils";
import {
	CommandSequenceEditor,
	type CommandSequenceEditorConditionalHandlers,
} from "./CommandSequenceEditor";

interface ConditionalBranchEditorModalOptions {
	app: App;
	plugin: QuickAdd;
	choices: IChoice[];
	title: string;
	/** Raw `thenCommands`/`elseCommands` out of data.json — see commandListOf. */
	commands: unknown;
	conditionalHandlers: CommandSequenceEditorConditionalHandlers;
}

export class ConditionalBranchEditorModal extends Modal {
	public waitForClose: Promise<ICommand[] | null>;
	private resolvePromise!: (commands: ICommand[] | null) => void;
	private commandEditor: CommandSequenceEditor | null = null;
	private workingCommands: unknown;
	private readonly plugin: QuickAdd;
	private readonly choices: IChoice[];
	private readonly conditionalHandlers: CommandSequenceEditorConditionalHandlers;
	private isResolved = false;

	constructor(options: ConditionalBranchEditorModalOptions) {
		super(options.app);
		this.plugin = options.plugin;
		this.choices = options.choices;
		this.conditionalHandlers = options.conditionalHandlers;
		this.workingCommands = deepClone(options.commands);

		this.waitForClose = new Promise<ICommand[] | null>((resolve) => {
			this.resolvePromise = resolve;
		});

		this.display(options.title);
		this.open();
	}

	onClose() {
		super.onClose();
		this.commandEditor?.destroy();
		if (!this.isResolved) {
			this.resolve(null);
		}
	}

	private resolve(value: ICommand[] | null) {
		if (this.isResolved) return;
		this.isResolved = true;
		this.resolvePromise(value);
	}

	private display(title: string) {
		this.containerEl.addClass("quickAddModal", "conditionalBranchModal");
		this.contentEl.empty();

		const headerEl = this.contentEl.createEl("h2", { text: title });
		headerEl.addClass("qa-modal-title");

		const editorContainer = this.contentEl.createDiv("branchCommandEditor");
		this.commandEditor = new CommandSequenceEditor({
			app: this.app,
			plugin: this.plugin,
			commands: this.workingCommands,
			choices: this.choices,
			onCommandsChange: (commands) => {
				this.workingCommands = commands;
			},
			conditionalHandlers: this.conditionalHandlers,
		});
		const editable = this.commandEditor.render(editorContainer);

		this.renderButtonBar(editable);
	}

	/**
	 * The Save button lives OUTSIDE the command editor, so suppressing the
	 * editor's own controls is not enough: Save resolves `workingCommands`, which
	 * MacroBuilder writes onto the conditional's `thenCommands`/`elseCommands`. If
	 * the branch held a value we could not read, that one click would replace it
	 * with the empty list we read it as. There is nothing to save in that state,
	 * so the button bar offers only a way out (#1593).
	 */
	private renderButtonBar(editable: boolean) {
		const buttonContainer = this.contentEl.createDiv({
			cls: "qa-command-button-row",
		});

		if (!editable) {
			new ButtonComponent(buttonContainer)
				.setCta()
				.setButtonText("Close")
				.onClick(() => {
					this.resolve(null);
					this.close();
				});
			return;
		}

		new ButtonComponent(buttonContainer)
			.setButtonText("Cancel")
			.onClick(() => {
				this.resolve(null);
				this.close();
			});

		new ButtonComponent(buttonContainer)
			.setCta()
			.setButtonText("Save")
			.onClick(() => {
				this.resolve(commandListOf(this.workingCommands));
				this.close();
			});
	}
}
