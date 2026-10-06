import type { App } from "obsidian";
import { ButtonComponent, Menu, Notice } from "obsidian";
import CommandList from "./CommandList.svelte";
import { editorCommands } from "./editorCommands";
import {
	createCommandListProps,
	type CommandListProps,
} from "./commandListProps.svelte";
import { mountComponent, type MountHandle } from "../svelte/mountComponent";
import type QuickAdd from "../../main";
import type { ICommand } from "../../types/macros/ICommand";
import type IChoice from "../../types/choices/IChoice";
import { ObsidianCommand } from "../../types/macros/ObsidianCommand";
import type { IObsidianCommand } from "../../types/macros/IObsidianCommand";
import { ChoiceCommand } from "../../types/macros/ChoiceCommand";
import { WaitCommand } from "../../types/macros/QuickCommands/WaitCommand";
import { NestedChoiceCommand } from "../../types/macros/QuickCommands/NestedChoiceCommand";
import { UserScript } from "../../types/macros/UserScript";
import GenericSuggester from "../GenericSuggester/genericSuggester";
import { confirmAction } from "../confirmAction";
import { pickUserScript } from "./pickUserScript";
import { log } from "../../logger/logManager";
import { reportingHandler } from "../../utils/errorUtils";
import { AIAssistantCommand } from "../../types/macros/QuickCommands/AIAssistantCommand";
import { AIAssistantCommandSettingsModal } from "./AIAssistantCommandSettingsModal";
import { settingsStore } from "../../settingsStore";
import { OpenFileCommand } from "../../types/macros/QuickCommands/OpenFileCommand";
import type { IConditionalCommand } from "../../types/macros/Conditional/IConditionalCommand";
import { ConditionalCommand } from "../../types/macros/Conditional/ConditionalCommand";
import { clearUserScriptSecretsFromCommand } from "../../utils/userScriptSecrets";
import {
	isUnreadableCommandList,
	normalizeCommandList,
} from "../../utils/macroUtils";
import DataUnreadable from "../svelte/DataUnreadable.svelte";
import { PRESETS } from "../choiceList/presets";
import { isTemplateChoice } from "../../types/choices/choiceType";
import { DEFAULT_TEMPLATE_FOLDER, readTemplateFolder } from "../choiceList/firstRun";
import { openNestedChoiceBuilder } from "./openNestedChoiceBuilder";
import { getCommandDisplayName } from "../../utils/macroHelpers";
import { newStep } from "../../v3/addStep";
import { lowerStep } from "../../v3/lower";

/**
 * Opens a branch's commands as a page. Mutates the command when the page is
 * left and then calls `onEdited`, synchronously, so the edit is saved before
 * the page under it saves (see BuilderPage).
 */
type BranchHandler = (command: IConditionalCommand, onEdited: () => void) => void;

export interface CommandSequenceEditorConditionalHandlers {
	configureCondition?: (command: IConditionalCommand) => Promise<boolean>;
	editThenBranch?: BranchHandler;
	editElseBranch?: BranchHandler;
}

interface CommandSequenceEditorOptions {
	app: App;
	plugin: QuickAdd;
	/**
	 * Typed `unknown` because it is not: this is `macro.commands` straight out of
	 * `data.json` (see commandListOf). The editor normalizes it at construction.
	 */
	commands: unknown;
	choices: IChoice[];
	onCommandsChange?: (commands: ICommand[]) => void;
	conditionalHandlers?: CommandSequenceEditorConditionalHandlers;
}

export class CommandSequenceEditor {
	private readonly app: App;
	private readonly plugin: QuickAdd;
	private readonly choices: IChoice[];
	private readonly onCommandsChange?: (commands: ICommand[]) => void;
	private readonly conditionalHandlers?: CommandSequenceEditorConditionalHandlers;

	private commandsRef: ICommand[];
	/**
	 * True when the value handed to us was not a list we could read AND could
	 * still be carrying commands (see isUnreadableCommandList). The editor is
	 * read-only in that state: `commandsRef` is an empty array that must never
	 * reach disk over the real value.
	 */
	private readonly unreadable: boolean;
	private obsidianCommands: IObsidianCommand[] = [];
	private commandListHandle: MountHandle | null = null;
	private commandListProps: CommandListProps | null = null;
	private containerEl: HTMLElement | null = null;
	private unreadableCardHandle: MountHandle | null = null;

	constructor(options: CommandSequenceEditorOptions) {
		this.app = options.app;
		this.plugin = options.plugin;
		// data.json is untrusted, so the value arrives raw and is made editable
		// here — the one seam every host that shows a command list goes through
		// (MacroBuilder, ConditionalBranchEditorPage). Normalizing keeps a
		// duplicate-id or id-less command under a fresh uuid instead of letting
		// the keyed {#each} throw and cost the user the whole editor (#1593).
		// Nothing is persisted by this: the repair reaches disk only with the
		// user's first ordinary edit, so opening and closing changes nothing.
		this.unreadable = isUnreadableCommandList(options.commands);
		this.commandsRef = normalizeCommandList(options.commands).commands;
		this.choices = options.choices;
		this.onCommandsChange = options.onCommandsChange;
		this.conditionalHandlers = options.conditionalHandlers;

		this.loadObsidianCommands();
	}

	/**
	 * @returns whether the editor is fully usable. False means the command list is
	 * showing a card instead, and the host must not commit `commandsRef` anywhere
	 * (see ConditionalBranchEditorPage.result).
	 */
	public render(containerEl: HTMLElement): boolean {
		this.destroy();
		this.containerEl = containerEl;
		containerEl.empty();
		containerEl.addClass("quickAddCommandEditor");

		// A list we could not read must not be edited blind. Every control below
		// appends to `commandsRef` and persists through onCommandsChange, so an
		// editor offered over a value we could not read would overwrite it with the
		// `[]` we read it as — destroying the only copy the user has. Say so
		// instead, and offer nothing that writes. The macro's name, "run on
		// startup" and icon stay editable around it.
		if (this.unreadable) {
			this.renderUnreadableCard(containerEl);
			return false;
		}

		// Belt and braces: the list is a readable array and every entry has been
		// given a unique id, so a mount failure here is a genuine bug rather than
		// bad data. Same reasoning as above though — with the list invisible the
		// user would be adding commands they cannot see, reorder or delete.
		if (!this.renderCommandList(containerEl)) return false;

		this.renderAddStep(containerEl);
		return true;
	}

	private renderUnreadableCard(parent: HTMLElement) {
		const cardEl = parent.createDiv("commandList");
		this.unreadableCardHandle = mountComponent(
			cardEl,
			DataUnreadable,
			{ what: "this macro's commands" },
			{ what: "this macro's commands" },
		);
	}

	public destroy() {
		this.commandListHandle?.destroy();
		this.commandListHandle = null;
		this.commandListProps = null;
		this.unreadableCardHandle?.destroy();
		this.unreadableCardHandle = null;
	}

	private loadObsidianCommands(): void {
		// @ts-ignore
		Object.keys(this.app.commands.commands).forEach((key) => {
			// @ts-ignore
			const command: { name: string; id: string } =
				this.app.commands.commands[key];

			this.obsidianCommands.push(new ObsidianCommand(command.name, command.id));
		});
	}

	/** @returns whether the list actually rendered (see render()). */
	private renderCommandList(parent: HTMLElement): boolean {
		const commandListEl = parent.createDiv("commandList");

		this.commandListProps = createCommandListProps({
			app: this.app,
			plugin: this.plugin,
			commands: this.commandsRef,
			deleteCommand: async (commandId: string) => {
				const command = this.commandsRef.find((c) => c.id === commandId);

				if (!command) {
					log.logError("command not found");
					throw new Error("command not found");
				}

				const promptAnswer = await confirmAction(this.app, {
					title: `Delete '${getCommandDisplayName(command)}'?`,
					message: "The command will be removed from this macro.",
					action: "Delete",
				});
				if (!promptAnswer) return;

				const secretsCleared = await clearUserScriptSecretsFromCommand(
					this.app,
					command
				);
				if (!secretsCleared) {
					new Notice(
						"Could not clear user script secrets. Command was not deleted."
					);
					return;
				}

				this.commandsRef = this.commandsRef.filter((c) => c.id !== commandId);
				this.emitCommandsChanged();
			},
			saveCommands: (commands: ICommand[]) => {
				this.commandsRef = commands;
				this.onCommandsChange?.(commands);
			},
			// Handlers mutate the command and return whether it changed; CommandList
			// persists the (proxy) mutation via its snapshot path.
			onConfigureCondition: this.conditionalHandlers?.configureCondition,
			onEditThenBranch: this.conditionalHandlers?.editThenBranch,
			onEditElseBranch: this.conditionalHandlers?.editElseBranch,
		});

		this.commandListHandle = mountComponent(
			commandListEl,
			CommandList,
			this.commandListProps,
			{ what: "this macro's commands" }
		);

		return this.commandListHandle.ok;
	}

	/** One button, which offers every kind of step this list can hold. */
	private renderAddStep(parent: HTMLElement) {
		const container = parent.createDiv("quickCommandContainer");
		const button = new ButtonComponent(container).setButtonText("Add a step");
		button.buttonEl.setAttribute("aria-label", "Add a step");
		button.buttonEl.setAttribute("aria-haspopup", "menu");
		button.buttonEl.setAttribute("aria-expanded", "false");
		button.onClick(() => this.openAddStepMenu(button.buttonEl));
	}

	private openAddStepMenu(button: HTMLElement) {
		const menu = new Menu();
		const add = (section: string, title: string, icon: string, run: () => void | Promise<void>) =>
			menu.addItem((item) =>
				item
					.setTitle(title)
					.setIcon(icon)
					.setSection(section)
					// Obsidian drops the handler's promise: a picker dismissed with
					// Escape would be an unhandled rejection.
					.onClick(reportingHandler("Couldn't add that step", run)),
			);
		const label = (section: string, title: string) =>
			menu.addItem((item) => item.setTitle(title).setIsLabel(true).setSection(section));

		label("write", "Write");
		add("write", "Create a note", "file-plus", () => this.addNestedChoice("newNote"));
		add("write", "Add to a note", "pencil", () => this.addNestedChoice("addToNote"));
		label("then", "Then");
		add("then", "Open a note", "file-search", () => this.addCommand(new OpenFileCommand()));
		add("then", "Link it", "link", () => this.addCommand(lowerStep(newStep("link"), "")));
		add("then", "Run Templater", "braces", () => this.addCommand(lowerStep(newStep("templater"), "")));
		add("then", "Run a script", "code", () => this.addUserScript());
		add("then", "Run a command", "terminal-square", () => this.addObsidianCommand());
		add("then", "Run an editor command", "text-cursor", () => this.addEditorCommand());
		if (!settingsStore.getState().disableOnlineFeatures) {
			add("then", "Ask AI", "bot", () => this.addAIAssistant());
		}
		add("then", "Run a choice", "play", () => this.addChoiceCommand());
		add("then", "If", "git-branch", () => this.addConditional());
		add("then", "Wait", "clock", () => this.addCommand(new WaitCommand(100)));

		button.setAttribute("aria-expanded", "true");
		menu.onHide(() => button.setAttribute("aria-expanded", "false"));
		// Under the button, which a key press has no position of its own for.
		const rect = button.getBoundingClientRect();
		menu.showAtPosition({ x: rect.left, y: rect.bottom + 4, width: rect.width, overlap: true, left: true });
	}

	/**
	 * A Create or Add step: a new choice made as the New choice menu's preset
	 * makes it, opened in its builder over this page.
	 */
	private addNestedChoice(presetId: "newNote" | "addToNote") {
		const preset = PRESETS.find((entry) => entry.id === presetId);
		if (!preset) throw new Error(`Missing preset '${presetId}'`);
		const templateFolder = readTemplateFolder(this.app, settingsStore.getState()) ?? DEFAULT_TEMPLATE_FOLDER;
		const choice = preset.create({ templateFolder });
		// A step leaves the note it creates closed: the steps after it act on the
		// note that is open, and an Open a note step opens it.
		if (isTemplateChoice(choice)) choice.openFile = false;
		const command = new NestedChoiceCommand(choice);
		this.addCommand(command);
		openNestedChoiceBuilder(this.app, this.plugin, command, (updated) => this.replaceCommand(updated));
	}

	private async addUserScript() {
		const script = await pickUserScript(this.app, { member: true });
		if (script) this.addCommand(new UserScript(script.name, script.path));
	}

	// A dismissed suggester rejects, which the menu's handler lets pass quietly.
	private async addObsidianCommand() {
		const picked = await GenericSuggester.Suggest(
			this.app,
			this.obsidianCommands.map((command) => command.name),
			this.obsidianCommands,
			"Obsidian command",
		);
		const command = new ObsidianCommand(picked.name, picked.commandId);
		command.generateId();
		this.addCommand(command);
	}

	private async addEditorCommand() {
		const types = [...editorCommands.keys()];
		const type = await GenericSuggester.Suggest(this.app, types, types, "Editor command");
		const Command = editorCommands.get(type);
		if (Command) this.addCommand(new Command());
	}

	private async addChoiceCommand() {
		const choice = await GenericSuggester.Suggest(
			this.app,
			this.choices.map((entry) => entry.name),
			this.choices,
			"Choice",
		);
		this.addCommand(new ChoiceCommand(choice.name, choice.id));
	}

	private async addAIAssistant() {
		const command = new AIAssistantCommand();
		this.addCommand(command);
		if (await new AIAssistantCommandSettingsModal(this.app, command).waitForClose) {
			this.replaceCommand({ ...command });
		}
	}

	private async addConditional() {
		const command = new ConditionalCommand();
		this.addCommand(command);
		if (await this.conditionalHandlers?.configureCondition?.(command)) {
			this.replaceCommand({ ...command });
		}
	}

	private addCommand(command: ICommand) {
		// Immutable add: callers (MacroBuilder, ConditionalBranchEditorPage) track
		// changes via onCommandsChange, not in-place mutation of the passed array.
		this.commandsRef = [...this.commandsRef, command];
		this.emitCommandsChanged();
	}

	/** A step edited after it was added, such as by its settings dialog. */
	private replaceCommand(command: ICommand) {
		this.commandsRef = this.commandsRef.map((entry) => (entry.id === command.id ? command : entry));
		this.emitCommandsChanged();
	}

	private emitCommandsChanged() {
		// Push the new array into the mounted component via its reactive $state props
		// bag (replaces the old exported updateCommandList() bridge).
		if (this.commandListProps) {
			this.commandListProps.commands = [...this.commandsRef];
		}
		this.onCommandsChange?.(this.commandsRef);
	}
}
