import { type App, SettingGroup } from "obsidian";
import type QuickAdd from "../../main";
import type IChoice from "../../types/choices/IChoice";
import type { ICommand } from "../../types/macros/ICommand";
import { deepClone } from "../../utils/deepClone";
import { commandListOf } from "../../utils/macroUtils";
import { BuilderPage } from "../ChoiceBuilder/builderPage";
import {
	CommandSequenceEditor,
	type CommandSequenceEditorConditionalHandlers,
} from "./CommandSequenceEditor";

interface ConditionalBranchEditorPageOptions {
	app: App;
	plugin: QuickAdd;
	choices: IChoice[];
	title: string;
	/** Raw `thenCommands`/`elseCommands` out of data.json - see commandListOf. */
	commands: unknown;
	conditionalHandlers: CommandSequenceEditorConditionalHandlers;
	/** The branch's commands when the page is left, or null if they were not edited. */
	onSave: (commands: ICommand[] | null) => void;
}

/** A Conditional's Then or Else commands, as a page over the macro. */
export class ConditionalBranchEditorPage extends BuilderPage<ICommand[] | null> {
	private commandEditor: CommandSequenceEditor | null = null;
	private workingCommands: unknown;
	private edited = false;
	private readonly plugin: QuickAdd;
	private readonly choices: IChoice[];
	private readonly conditionalHandlers: CommandSequenceEditorConditionalHandlers;

	constructor(options: ConditionalBranchEditorPageOptions) {
		super(options.app, options.title, options.onSave);
		this.plugin = options.plugin;
		this.choices = options.choices;
		this.conditionalHandlers = options.conditionalHandlers;
		this.workingCommands = deepClone(options.commands);
		this.containerEl.addClass("conditionalBranchPage");
	}

	protected render(containerEl: HTMLElement): void {
		this.commandEditor = new CommandSequenceEditor({
			app: this.app,
			plugin: this.plugin,
			commands: this.workingCommands,
			choices: this.choices,
			onCommandsChange: (commands) => {
				this.workingCommands = commands;
				this.edited = true;
			},
			conditionalHandlers: this.conditionalHandlers,
		});
		const commandsEl = new SettingGroup(containerEl).setHeading("Commands").listEl;
		this.commandEditor.render(commandsEl.createDiv("branchCommandEditor"));
	}

	/**
	 * Only an edit is saved, so opening and leaving a branch writes nothing.
	 * That also covers a branch holding a value we could not read: the editor
	 * offers nothing that edits it, so the empty list we read it as never
	 * replaces it (#1593).
	 */
	protected result(): ICommand[] | null {
		return this.edited ? commandListOf(this.workingCommands) : null;
	}

	protected destroy(): void {
		this.commandEditor?.destroy();
		this.commandEditor = null;
	}
}
