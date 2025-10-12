import type { IMacro } from "../../types/macros/IMacro";
import type { App } from "obsidian";
import { Modal, Setting } from "obsidian";
import GenericInputPrompt from "../GenericInputPrompt/GenericInputPrompt";
import type IChoice from "../../types/choices/IChoice";
import type IMacroChoice from "../../types/choices/IMacroChoice";
import type QuickAdd from "../../main";
import type { MultiChoice } from "src/types/choices/MultiChoice";
import {
	CommandSequenceEditor,
	type CommandSequenceEditorConditionalHandlers,
} from "./CommandSequenceEditor";
import type { IConditionalCommand } from "../../types/macros/Conditional/IConditionalCommand";
import { ConditionalCommandSettingsModal } from "./ConditionalCommandSettingsModal";
import { ConditionalBranchEditorModal } from "./ConditionalBranchEditorModal";

function getChoicesAsList(nestedChoices: IChoice[]): IChoice[] {
	const arr: IChoice[] = [];

	const recursive = (choices: IChoice[]) => {
		choices.forEach((choice) => {
			if (choice.type === "Multi") {
				recursive((choice as MultiChoice).choices);
			} else {
				arr.push(choice);
			}
		});
	};

	recursive(nestedChoices);

	return arr;
}

export class MacroBuilder extends Modal {
	public choice: IMacroChoice;
	public macro: IMacro;
	public waitForClose: Promise<IMacroChoice>;
	private readonly choices: IChoice[] = [];
	private commandEditor: CommandSequenceEditor | null = null;
	private resolvePromise: (choice: IMacroChoice) => void;
	private plugin: QuickAdd;

	constructor(app: App, plugin: QuickAdd, choice: IMacroChoice, choices: IChoice[]) {
		super(app);
		this.choice = choice;
		this.macro = choice.macro;
		this.choices = getChoicesAsList(choices);
		this.plugin = plugin;

		this.waitForClose = new Promise<IMacroChoice>(
			(resolve) => {
				this.resolvePromise = resolve;
			}
		);

		this.display();
		this.open();
	}

	onClose() {
		super.onClose();
		this.resolvePromise(this.choice);
		this.commandEditor?.destroy();
		this.commandEditor = null;
	}

	protected display() {
		this.containerEl.addClass("quickAddModal", "macroBuilder");
		this.contentEl.empty();
		this.addCenteredHeader(this.choice.name);
		this.addCommandEditor();
		this.addRunOnStartupSetting();
	}

	protected addCenteredHeader(header: string): void {
		const headerEl = this.contentEl.createEl("h2");
		headerEl.style.textAlign = "center";
		headerEl.setText(header);
		headerEl.addClass("clickable");

		 
		headerEl.addEventListener("click", async () => {
			const newName: string = await GenericInputPrompt.Prompt(
				this.app,
				`Update name for ${this.choice.name}`,
				this.choice.name
			);
			if (!newName) return;

			// Keep choice name and macro name in sync
			this.choice.name = newName;
			this.macro.name = newName;
			this.reload();
		});
	}

	private addRunOnStartupSetting(): void {
		new Setting(this.contentEl)
			.setName("Run on startup")
			.setDesc("Execute this macro when Obsidian starts")
			.addToggle(toggle => toggle
				.setValue(this.choice.runOnStartup)
				.onChange(value => {
					this.choice.runOnStartup = value;
				})
			);
	}

	private reload() {
		this.commandEditor?.destroy();
		this.commandEditor = null;
		this.display();
	}

	private addCommandEditor() {
		const editorContainer = this.contentEl.createDiv("macroBuilder__editor");
		this.commandEditor = new CommandSequenceEditor({
			app: this.app,
			plugin: this.plugin,
			commands: this.macro.commands,
			choices: this.choices,
			onCommandsChange: (commands) => {
				this.macro.commands = commands;
			},
			conditionalHandlers: this.buildConditionalHandlers(),
		});

		this.commandEditor.render(editorContainer);
	}

	private buildConditionalHandlers(): CommandSequenceEditorConditionalHandlers {
		return {
			configureCondition: (command) =>
				this.configureConditionalCondition(command),
			editThenBranch: (command) =>
				this.configureConditionalBranch(command, "then"),
			editElseBranch: (command) =>
				this.configureConditionalBranch(command, "else"),
		};
	}

	private async configureConditionalCondition(
		command: IConditionalCommand
	): Promise<boolean> {
		const modal = new ConditionalCommandSettingsModal(this.app, command);
		const result = await modal.waitForClose;
		return result !== null;
	}

	private async configureConditionalBranch(
		command: IConditionalCommand,
		branch: "then" | "else"
	): Promise<boolean> {
		const title = branch === "then" ? "Then branch" : "Else branch";
		const modal = new ConditionalBranchEditorModal({
			app: this.app,
			plugin: this.plugin,
			choices: this.choices,
			title: `Edit ${title} commands`,
			commands: branch === "then" ? command.thenCommands : command.elseCommands,
			conditionalHandlers: this.buildConditionalHandlers(),
		});

		const updatedCommands = await modal.waitForClose;
		if (!updatedCommands) return false;

		if (branch === "then") {
			command.thenCommands = updatedCommands;
		} else {
			command.elseCommands = updatedCommands;
		}

		return true;
	}
}
