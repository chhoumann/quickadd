import type {
	App,
	DropdownComponent,
	TextComponent,
} from "obsidian";
import { ButtonComponent, Notice, Setting } from "obsidian";
import CommandList from "./CommandList.svelte";
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
import { CaptureChoice } from "../../types/choices/CaptureChoice";
import { TemplateChoice } from "../../types/choices/TemplateChoice";
import {
	type ScriptCandidate,
	candidateLabel,
	loadScriptCandidates,
	noteScriptError,
	resolveScriptSelector,
} from "./scriptCandidates";
import { UserScript } from "../../types/macros/UserScript";
import { GenericTextSuggester } from "../suggesters/genericTextSuggester";
import GenericYesNoPrompt from "../GenericYesNoPrompt/GenericYesNoPrompt";
import { showNoScriptsFoundNotice } from "./noScriptsFoundNotice";
import InputSuggester from "../InputSuggester/inputSuggester";
import { log } from "../../logger/logManager";
import type { IEditorCommand } from "../../types/macros/EditorCommands/IEditorCommand";
import { EditorCommandType } from "../../types/macros/EditorCommands/EditorCommandType";
import { CopyCommand } from "../../types/macros/EditorCommands/CopyCommand";
import { CutCommand } from "../../types/macros/EditorCommands/CutCommand";
import { PasteCommand } from "../../types/macros/EditorCommands/PasteCommand";
import { PasteWithFormatCommand } from "../../types/macros/EditorCommands/PasteWithFormatCommand";
import { SelectActiveLineCommand } from "../../types/macros/EditorCommands/SelectActiveLineCommand";
import { SelectLinkOnActiveLineCommand } from "../../types/macros/EditorCommands/SelectLinkOnActiveLineCommand";
import { MoveCursorToFileStartCommand } from "../../types/macros/EditorCommands/MoveCursorToFileStartCommand";
import { MoveCursorToFileEndCommand } from "../../types/macros/EditorCommands/MoveCursorToFileEndCommand";
import { MoveCursorToLineStartCommand } from "../../types/macros/EditorCommands/MoveCursorToLineStartCommand";
import { MoveCursorToLineEndCommand } from "../../types/macros/EditorCommands/MoveCursorToLineEndCommand";
import { AIAssistantCommand } from "../../types/macros/QuickCommands/AIAssistantCommand";
import type { IconType } from "../../types/IconType";
import { settingsStore } from "../../settingsStore";
import { OpenFileCommand } from "../../types/macros/QuickCommands/OpenFileCommand";
import type { IConditionalCommand } from "../../types/macros/Conditional/IConditionalCommand";
import { getUserScriptMemberAccess } from "../../utilityObsidian";
import { ConditionalCommand } from "../../types/macros/Conditional/ConditionalCommand";
import { clearUserScriptSecretsFromCommand } from "../../utils/userScriptSecrets";

type ConditionalHandler = (command: IConditionalCommand) => Promise<boolean>;

export interface CommandSequenceEditorConditionalHandlers {
	configureCondition?: ConditionalHandler;
	editThenBranch?: ConditionalHandler;
	editElseBranch?: ConditionalHandler;
}

export interface CommandSequenceEditorOptions {
	app: App;
	plugin: QuickAdd;
	commands: ICommand[];
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
	private obsidianCommands: IObsidianCommand[] = [];
	private scriptCandidates: ScriptCandidate[] = [];
	private commandListHandle: MountHandle | null = null;
	private commandListProps: CommandListProps | null = null;
	private containerEl: HTMLElement | null = null;

	constructor(options: CommandSequenceEditorOptions) {
		this.app = options.app;
		this.plugin = options.plugin;
		this.commandsRef = options.commands;
		this.choices = options.choices;
		this.onCommandsChange = options.onCommandsChange;
		this.conditionalHandlers = options.conditionalHandlers;

		this.loadObsidianCommands();
		this.loadScriptCandidates();
	}

	public render(containerEl: HTMLElement) {
		this.destroy();
		this.containerEl = containerEl;
		containerEl.empty();
		containerEl.addClass("quickAddCommandEditor");

		this.renderCommandList(containerEl);
		this.renderCommandBar(containerEl);
		this.renderAddObsidianCommandSetting(containerEl);
		this.renderAddEditorCommandSetting(containerEl);
		this.renderAddUserScriptSetting(containerEl);
		this.renderAddChoiceSetting(containerEl);
	}

	public destroy() {
		this.commandListHandle?.destroy();
		this.commandListHandle = null;
		this.commandListProps = null;
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

	private loadScriptCandidates(): void {
		this.scriptCandidates = loadScriptCandidates(this.app);
	}

	private renderCommandList(parent: HTMLElement) {
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

				const promptAnswer: boolean = await GenericYesNoPrompt.Prompt(
					this.app,
					"Are you sure you wish to delete this command?",
					`If you click yes, you will delete '${command.name}'.`
				);
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
			this.commandListProps
		);
	}

	private renderCommandBar(parent: HTMLElement) {
		const quickCommandContainer: HTMLDivElement = parent.createDiv(
			"quickCommandContainer"
		);

		this.addChoiceButton(quickCommandContainer, "Capture", CaptureChoice);
		this.addChoiceButton(quickCommandContainer, "Template", TemplateChoice);
		this.addOpenFileCommandButton(quickCommandContainer);
		this.addWaitCommandButton(quickCommandContainer);
		this.addConditionalCommandButton(quickCommandContainer);

		if (!settingsStore.getState().disableOnlineFeatures) {
			this.addAIAssistantCommandButton(quickCommandContainer);
		}
	}

	private renderAddObsidianCommandSetting(parent: HTMLElement) {
		let input: TextComponent;

		const addObsidianCommandFromInput = () => {
			const value: string = input.getValue();
			const obsidianCommand = this.obsidianCommands.find((v) => v.name === value);

			if (!obsidianCommand) {
				log.logError(`Could not find Obsidian command with name "${value}"`);
				return;
			}

			const command = new ObsidianCommand(
				obsidianCommand.name,
				obsidianCommand.commandId
			);
			command.generateId();

			this.addCommand(command);

			input.setValue("");
		};

		new Setting(parent)
			.setName("Obsidian command")
			.setDesc("Add an Obsidian command")
			.addText((textComponent) => {
				input = textComponent;
				textComponent.inputEl.addClass("qa-command-sequence-input");
				textComponent.setPlaceholder("Obsidian command");
				new GenericTextSuggester(
					this.app,
					textComponent.inputEl,
					this.obsidianCommands.map((c) => c.name)
				);

				textComponent.inputEl.addEventListener(
					"keypress",
					(e: KeyboardEvent) => {
						if (e.key === "Enter") {
							addObsidianCommandFromInput();
						}
					}
				);
			})
			.addButton((button) =>
				button.setCta().setButtonText("Add").onClick(addObsidianCommandFromInput)
			);
	}

	private renderAddEditorCommandSetting(parent: HTMLElement) {
		let dropdownComponent: DropdownComponent;

		const addEditorCommandFromDropdown = () => {
			const type: EditorCommandType =
				dropdownComponent.getValue() as EditorCommandType;
			let command: IEditorCommand;

			switch (type) {
				case EditorCommandType.Copy:
					command = new CopyCommand();
					break;
				case EditorCommandType.Cut:
					command = new CutCommand();
					break;
				case EditorCommandType.Paste:
					command = new PasteCommand();
					break;
				case EditorCommandType.PasteWithFormat:
					command = new PasteWithFormatCommand();
					break;
				case EditorCommandType.SelectActiveLine:
					command = new SelectActiveLineCommand();
					break;
				case EditorCommandType.SelectLinkOnActiveLine:
					command = new SelectLinkOnActiveLineCommand();
					break;
				case EditorCommandType.MoveCursorToFileStart:
					command = new MoveCursorToFileStartCommand();
					break;
				case EditorCommandType.MoveCursorToFileEnd:
					command = new MoveCursorToFileEndCommand();
					break;
				case EditorCommandType.MoveCursorToLineStart:
					command = new MoveCursorToLineStartCommand();
					break;
				case EditorCommandType.MoveCursorToLineEnd:
					command = new MoveCursorToLineEndCommand();
					break;
				default:
					log.logError("invalid editor command type");
					throw new Error("invalid editor command type");
			}

			this.addCommand(command);
			dropdownComponent.setValue("");
		};

		new Setting(parent)
			.setName("Editor commands")
			.setDesc("Add editor command")
			.addDropdown((dropdown) => {
				dropdownComponent = dropdown;
				dropdown.selectEl.addClass("qa-command-sequence-input");
				dropdown
					.addOption("", "Select command")
					.addOption(EditorCommandType.Copy, EditorCommandType.Copy)
					.addOption(EditorCommandType.Cut, EditorCommandType.Cut)
					.addOption(EditorCommandType.Paste, EditorCommandType.Paste)
					.addOption(
						EditorCommandType.PasteWithFormat,
						EditorCommandType.PasteWithFormat
					)
					.addOption(
						EditorCommandType.SelectActiveLine,
						EditorCommandType.SelectActiveLine
					)
					.addOption(
						EditorCommandType.SelectLinkOnActiveLine,
						EditorCommandType.SelectLinkOnActiveLine
					)
					.addOption(
						EditorCommandType.MoveCursorToFileStart,
						EditorCommandType.MoveCursorToFileStart
					)
					.addOption(
						EditorCommandType.MoveCursorToFileEnd,
						EditorCommandType.MoveCursorToFileEnd
					)
					.addOption(
						EditorCommandType.MoveCursorToLineStart,
						EditorCommandType.MoveCursorToLineStart
					)
					.addOption(
						EditorCommandType.MoveCursorToLineEnd,
						EditorCommandType.MoveCursorToLineEnd
					);
			})
			.addButton((button) =>
				button.setCta().setButtonText("Add").onClick(addEditorCommandFromDropdown)
			);
	}

	private renderAddUserScriptSetting(parent: HTMLElement) {
		let input!: TextComponent;
		let addButton: ButtonComponent | null = null;

		const addUserScriptFromInput = async () => {
			// Refresh so scripts/notes created while this editor is open resolve.
			this.loadScriptCandidates();
			const value: string = input.getValue().trim();
			if (!value) return;
			const selector = getUserScriptMemberAccess(value).basename ?? value;

			// Notes resolve by path (so a bare basename never picks a note over a
			// same-named .js); .js keeps basename matching. Member access (`::`) is
			// preserved in `value`, which becomes the command name.
			const resolved = resolveScriptSelector(
				this.app,
				this.scriptCandidates,
				selector,
			);
			if (!resolved) return;

			if (resolved.isMarkdown) {
				const reason = await noteScriptError(this.app, resolved.file);
				if (reason) {
					new Notice(`QuickAdd: "${resolved.file.path}" — ${reason}`);
					return;
				}
			}

			this.addCommand(new UserScript(value, resolved.file.path));

			input.setValue("");
			if (addButton) {
				addButton.buttonEl.addClass("qa-hidden");
			}
		};

		new Setting(parent)
			.setName("User Scripts")
			.setDesc("Add a .js file or a note with a ```js code block - type the name or click Browse")
			.addText((textComponent) => {
				input = textComponent;
				textComponent.inputEl.addClass("qa-command-sequence-input");
				textComponent.setPlaceholder("Start typing script name...");

				new GenericTextSuggester(
					this.app,
					textComponent.inputEl,
					this.scriptCandidates.map((c) => candidateLabel(c))
				);

				textComponent.inputEl.addEventListener(
					"keypress",
					(e: KeyboardEvent) => {
						if (e.key === "Enter") {
							void addUserScriptFromInput();
						}
					}
				);
			})
			.addButton((button) =>
				button
					.setButtonText("Browse")
					.setTooltip("Browse and select a script (.js file or note)")
					.onClick(async () => {
						const selected = await this.showScriptPicker();
						if (selected) {
							const name = selected.isMarkdown
								? selected.file.path
								: selected.file.basename;
							this.addCommand(new UserScript(name, selected.file.path));
						}
					})
			)
			.addButton((button) => {
				addButton = button;
				button
					.setButtonText("Add")
					.setCta()
					.onClick(() => void addUserScriptFromInput());
				button.buttonEl.addClass("qa-hidden");
			});

		input.onChange((value) => {
			if (!addButton) return;
			addButton.buttonEl.toggleClass("qa-hidden", value.trim().length === 0);
		});
	}

	private renderAddChoiceSetting(parent: HTMLElement) {
		let input: TextComponent;

		const addChoiceFromInput = () => {
			const value: string = input.getValue();
			const choice = this.choices.find((c) => c.name === value);
			if (!choice) return;

			this.addCommand(new ChoiceCommand(choice.name, choice.id));

			input.setValue("");
		};

		new Setting(parent)
			.setName("Choices")
			.setDesc("Add existing choice")
			.addText((textComponent) => {
				input = textComponent;
				textComponent.inputEl.addClass("qa-command-sequence-input");
				textComponent.setPlaceholder("Choice");
				new GenericTextSuggester(
					this.app,
					textComponent.inputEl,
					this.choices.map((c) => c.name)
				);

				textComponent.inputEl.addEventListener("keypress", (e: KeyboardEvent) => {
					if (e.key === "Enter") {
						addChoiceFromInput();
					}
				});
			})
			.addButton((button) =>
				button.setCta().setButtonText("Add").onClick(addChoiceFromInput)
			);
	}

	private addChoiceButton(
		container: HTMLDivElement,
		typeName: string,
		Type: typeof TemplateChoice | typeof CaptureChoice
	) {
		const button: ButtonComponent = new ButtonComponent(container);
		button
			.setButtonText(typeName)
			.setTooltip(`Add ${typeName} Choice`)
			.onClick(() => {
				const newChoice: IChoice = new Type(`Untitled ${typeName} Choice`);
				this.addCommand(new NestedChoiceCommand(newChoice));
			});
	}

	private addOpenFileCommandButton(container: HTMLDivElement) {
		const button: ButtonComponent = new ButtonComponent(container);
		button
			.setIcon("file-search")
			.setTooltip("Add Open File command")
			.onClick(() => {
				this.addCommand(new OpenFileCommand());
			});
	}

	private addAIAssistantCommandButton(container: HTMLDivElement) {
		const button: ButtonComponent = new ButtonComponent(container);
		button
			.setIcon("bot" as IconType)
			.setTooltip("Add AI Assistant command")
			.onClick(() => {
				this.addCommand(new AIAssistantCommand());
			});
	}

	private addWaitCommandButton(container: HTMLDivElement) {
		const button: ButtonComponent = new ButtonComponent(container);
		button
			.setIcon("clock")
			.setTooltip("Add wait command")
			.onClick(() => {
				this.addCommand(new WaitCommand(100));
			});
	}

	private addConditionalCommandButton(container: HTMLDivElement) {
		const button: ButtonComponent = new ButtonComponent(container);
		button
			.setIcon("git-branch")
			.setTooltip("Add conditional command")
			.onClick(() => {
				this.addCommand(new ConditionalCommand());
			});
	}

	private async showScriptPicker(): Promise<ScriptCandidate | null> {
		// Refresh so scripts/notes created while this editor is open are listed.
		this.loadScriptCandidates();
		if (this.scriptCandidates.length === 0) {
			showNoScriptsFoundNotice(this.app);
			return null;
		}

		// One unified list: .js paths and notes-with-a-code-block, keyed by path.
		const paths = this.scriptCandidates.map((c) => c.file.path);
		const labels = this.scriptCandidates.map((c) => candidateLabel(c));
		const selectedPath = await InputSuggester.Suggest(
			this.app,
			labels,
			paths,
			{
				placeholder: "Select a script (.js file or note with a ```js block)",
				emptyStateText: "No scripts found in your vault",
			}
		);

		if (!selectedPath) return null;

		const candidate = this.scriptCandidates.find(
			(c) => c.file.path === selectedPath
		);
		if (!candidate) return null;

		if (candidate.isMarkdown) {
			const reason = await noteScriptError(this.app, candidate.file);
			if (reason) {
				new Notice(`QuickAdd: "${candidate.file.path}" — ${reason}`);
				return null;
			}
		}

		return candidate;
	}

	private addCommand(command: ICommand) {
		// Immutable add: callers (MacroBuilder, ConditionalBranchEditorModal) track
		// changes via onCommandsChange, not in-place mutation of the passed array.
		this.commandsRef = [...this.commandsRef, command];
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
