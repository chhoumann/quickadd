import type { IMacro } from "../../types/macros/IMacro";
import type { App } from "obsidian";
import { SettingGroup } from "obsidian";
import type IChoice from "../../types/choices/IChoice";
import type IMacroChoice from "../../types/choices/IMacroChoice";
import type { ChoiceBuilderPlugin } from "../../types/pluginContext";
import {
	CommandSequenceEditor,
	type CommandSequenceEditorConditionalHandlers,
} from "./CommandSequenceEditor";
import type { IConditionalCommand } from "../../types/macros/Conditional/IConditionalCommand";
import { ConditionalCommandSettingsModal } from "./ConditionalCommandSettingsModal";
import { ConditionalBranchEditorPage } from "./ConditionalBranchEditorPage";
import { getConditionSummary } from "../../utils/conditionalHelpers";
import { BuilderPage, nameOrFallback } from "../ChoiceBuilder/builderPage";
import { flattenChoices } from "../../utils/choiceUtils";
import {
	isMacroObject,
	macroCommandsValueOf,
} from "../../utils/macroUtils";
import type { ICommand } from "../../types/macros/ICommand";
import { uuidv4 } from "../../utils/uuid";
import { mountComponent, type MountHandle } from "../svelte/mountComponent";
import { snapshot } from "../svelte/persist.svelte";
import { reactiveProps } from "../svelte/reactiveProps.svelte";
import MacroBehaviorSettings, { type MacroBehavior } from "./MacroBehaviorSettings.svelte";

interface MacroBehaviorProps {
	behavior: MacroBehavior;
	name: string;
	app: App;
}

export class MacroBuilder extends BuilderPage<IMacroChoice> {
	public choice: IMacroChoice;
	public macro: IMacro;
	private readonly choices: IChoice[] = [];
	private commandEditor: CommandSequenceEditor | null = null;
	private plugin: ChoiceBuilderPlugin;
	private readonly openedName: string;
	private behaviorHandle: MountHandle | null = null;
	/** The Behavior group's edits, which `result()` commits to the choice. */
	private behaviorProps: MacroBehaviorProps | null = null;

	constructor(
		app: App,
		plugin: ChoiceBuilderPlugin,
		choice: IMacroChoice,
		choices: IChoice[],
		onSave: (choice: IMacroChoice) => void,
	) {
		super(app, choice.name, onSave);
		this.choice = choice;
		this.macro = choice.macro;
		this.openedName = choice.name;
		// Every runnable choice but this one; folders cannot be a macro step.
		this.choices = flattenChoices(choices).filter(
			(c) => c.type !== "Multi" && c.id !== choice.id,
		);
		this.plugin = plugin;
		this.containerEl.addClass("macroBuilder");
	}

	protected result(): IMacroChoice {
		const name = nameOrFallback(this.choice.name, this.openedName);
		this.choice.name = name;
		if (isMacroObject(this.macro)) this.macro.name = name;
		if (this.behaviorProps) Object.assign(this.choice, snapshot(this.behaviorProps.behavior));
		return this.choice;
	}

	protected destroy(): void {
		this.commandEditor?.destroy();
		this.commandEditor = null;
		this.behaviorHandle?.destroy();
		this.behaviorHandle = null;
	}

	protected render(containerEl: HTMLElement) {
		this.addNameSetting(containerEl, this.choice.name, this.openedName, (name) => {
			// Keep choice name and macro name in sync. The macro object can be
			// missing from a hand-edited data.json; renaming the choice still has
			// to work, so only sync a macro that is there.
			this.choice.name = name;
			if (isMacroObject(this.macro)) this.macro.name = name;
			if (this.behaviorProps) this.behaviorProps.name = name.trim() || this.openedName;
		});
		this.addCommandEditor(this.addGroup(containerEl, "Commands"));
		this.addBehaviorSettings(this.addGroup(containerEl, "Behavior"));
	}

	/** An Obsidian setting group; returns the element its settings go in. */
	private addGroup(containerEl: HTMLElement, heading: string): HTMLElement {
		return new SettingGroup(containerEl).setHeading(heading).listEl;
	}

	private addBehaviorSettings(parent: HTMLElement): void {
		const { onePageInput, dateOrigin, runOnStartup, command, pickDayCommand, icon } = this.choice;
		const props = reactiveProps<MacroBehaviorProps>({
			behavior: snapshot({ onePageInput, dateOrigin, runOnStartup, command, pickDayCommand, icon }),
			name: this.choice.name,
			app: this.app,
		});
		this.behaviorHandle = mountComponent(parent, MacroBehaviorSettings, props, {
			what: "the macro's settings",
		});
		// Unseen settings must not replace the choice's own on close.
		if (this.behaviorHandle.ok) this.behaviorProps = props;
	}

	/**
	 * The value to show as this macro's command list.
	 *
	 * `choice.macro` is untrusted too, and a Macro choice whose `macro` key is
	 * missing entirely used to make "Configure" do nothing at all: the builder
	 * threw while it rendered.
	 *
	 * Three cases, and `macro` being an ARRAY is the one worth naming: `[]` and
	 * `[{...}]` are both objects, but writing `macro.commands` onto an Array sets
	 * a non-index property that `JSON.stringify` drops, so the user's edits would
	 * vanish on every save while the editor happily showed them. Handing the array
	 * itself over as the command list instead means its entries render as the
	 * commands they probably are, and `setMacroCommands` materializes a real macro
	 * object around them on the first edit - nothing lost either way.
	 */
	private macroCommandsValue(): unknown {
		return macroCommandsValueOf(this.macro);
	}

	/**
	 * Commit an edit back onto the choice, materializing the macro object if it
	 * was missing. Only reachable when the editor is usable, which
	 * `macroCommandsValue` guarantees means nothing readable is being replaced.
	 */
	private setMacroCommands(commands: ICommand[]) {
		if (!isMacroObject(this.macro)) {
			this.macro = { id: uuidv4(), name: this.choice.name, commands };
			this.choice.macro = this.macro;
			return;
		}
		this.macro.commands = commands;
	}

	private addCommandEditor(parent: HTMLElement) {
		const editorContainer = parent.createDiv("macroBuilder__editor");
		this.commandEditor = new CommandSequenceEditor({
			app: this.app,
			plugin: this.plugin,
			commands: this.macroCommandsValue(),
			choices: this.choices,
			onCommandsChange: (commands) => {
				this.setMacroCommands(commands);
			},
			conditionalHandlers: this.buildConditionalHandlers(),
		});

		this.commandEditor.render(editorContainer);
	}

	private buildConditionalHandlers(): CommandSequenceEditorConditionalHandlers {
		return {
			configureCondition: (command) =>
				this.configureConditionalCondition(command),
			editThenBranch: (command, onEdited) =>
				this.openBranchPage(command, "then", onEdited),
			editElseBranch: (command, onEdited) =>
				this.openBranchPage(command, "else", onEdited),
		};
	}

	private async configureConditionalCondition(
		command: IConditionalCommand
	): Promise<boolean> {
		const modal = new ConditionalCommandSettingsModal(this.app, command);
		const result = await modal.waitForClose;
		return result !== null;
	}

	/**
	 * A branch's commands, as a page over this one. Its edits land on the
	 * command when the page is left, and `onEdited` saves them into this
	 * macro's list before anything below hears about it.
	 */
	private openBranchPage(
		command: IConditionalCommand,
		branch: "then" | "else",
		onEdited: () => void,
	): void {
		new ConditionalBranchEditorPage({
			app: this.app,
			plugin: this.plugin,
			choices: this.choices,
			title: `${branch === "then" ? "Then" : "Else"}: ${getConditionSummary(command.condition)}`,
			commands: branch === "then" ? command.thenCommands : command.elseCommands,
			conditionalHandlers: this.buildConditionalHandlers(),
			onSave: (commands) => {
				if (!commands) return;
				if (branch === "then") command.thenCommands = commands;
				else command.elseCommands = commands;
				onEdited();
			},
		}).open();
	}
}
