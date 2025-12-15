import { Modal, ButtonComponent } from "obsidian";
import type { App } from "obsidian";
import type QuickAdd from "../../main";
import type IChoice from "../../types/choices/IChoice";
import type { ICommand } from "../../types/macros/ICommand";
import { deepClone } from "../../utils/deepClone";
import {
	CommandSequenceEditor,
	type CommandSequenceEditorConditionalHandlers,
} from "./CommandSequenceEditor";

interface ConditionalBranchEditorModalOptions {
	app: App;
	plugin: QuickAdd;
	choices: IChoice[];
	title: string;
	commands: ICommand[];
	conditionalHandlers: CommandSequenceEditorConditionalHandlers;
}

export class ConditionalBranchEditorModal extends Modal {
	public waitForClose: Promise<ICommand[] | null>;
	private resolvePromise!: (commands: ICommand[] | null) => void;
	private commandEditor: CommandSequenceEditor | null = null;
	private workingCommands: ICommand[];
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
		headerEl.style.textAlign = "center";

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
		this.commandEditor.render(editorContainer);

		this.renderButtonBar();
	}

	private renderButtonBar() {
		const buttonContainer = this.contentEl.createDiv();
		buttonContainer.style.display = "flex";
		buttonContainer.style.justifyContent = "flex-end";
		buttonContainer.style.gap = "12px";
		buttonContainer.style.marginTop = "20px";

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
				this.resolve(this.workingCommands);
				this.close();
			});
	}
}
