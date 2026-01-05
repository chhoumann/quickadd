import type {
	App,
	DropdownComponent,
	TextComponent,
	TFile,
} from "obsidian";
import { ButtonComponent, Setting } from "obsidian";
import CommandList from "./CommandList.svelte";
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
import { USER_SCRIPT_FILE_EXTENSION_REGEX } from "../../constants";
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
import { AIAssistantCommand } from "../../types/macros/QuickCommands/AIAssistantCommand";
import type { IconType } from "../../types/IconType";
import { settingsStore } from "../../settingsStore";
import { OpenFileCommand } from "../../types/macros/QuickCommands/OpenFileCommand";
import type { IConditionalCommand } from "../../types/macros/Conditional/IConditionalCommand";
import { getUserScriptMemberAccess } from "../../utilityObsidian";
import { ConditionalCommand } from "../../types/macros/Conditional/ConditionalCommand";

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
	private javascriptFiles: TFile[] = [];
	private commandListComponent: CommandList | null = null;
	private containerEl: HTMLElement | null = null;

	constructor(options: CommandSequenceEditorOptions) {
		this.app = options.app;
		this.plugin = options.plugin;
		this.commandsRef = options.commands;
		this.choices = options.choices;
		this.onCommandsChange = options.onCommandsChange;
		this.conditionalHandlers = options.conditionalHandlers;

		this.loadObsidianCommands();
		this.loadJavascriptFiles();
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
		this.commandListComponent?.$destroy();
		this.commandListComponent = null;
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

	private loadJavascriptFiles(): void {
		this.javascriptFiles = this.app.vault
			.getFiles()
			.filter((file) => USER_SCRIPT_FILE_EXTENSION_REGEX.test(file.path));
	}

	private renderCommandList(parent: HTMLElement) {
		const commandListEl = parent.createDiv("commandList");

		this.commandListComponent = new CommandList({
			target: commandListEl,
			props: {
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

					this.commandsRef = this.commandsRef.filter(
						(c) => c.id !== commandId
					);
					this.emitCommandsChanged();
				},
				saveCommands: (commands: ICommand[]) => {
					this.commandsRef = commands;
					this.onCommandsChange?.(commands);
				},
			},
		});

		if (this.conditionalHandlers?.configureCondition) {
			this.commandListComponent.$on(
				"configureCondition",
				async (event: CustomEvent<IConditionalCommand>) => {
					const updated = await this.conditionalHandlers?.configureCondition?.(
						event.detail
					);
					if (updated) {
						this.emitCommandsChanged();
					}
				}
			);
		}

		if (this.conditionalHandlers?.editThenBranch) {
			this.commandListComponent.$on(
				"editThenBranch",
				async (event: CustomEvent<IConditionalCommand>) => {
					const updated = await this.conditionalHandlers?.editThenBranch?.(
						event.detail
					);
					if (updated) {
						this.emitCommandsChanged();
					}
				}
			);
		}

		if (this.conditionalHandlers?.editElseBranch) {
			this.commandListComponent.$on(
				"editElseBranch",
				async (event: CustomEvent<IConditionalCommand>) => {
					const updated = await this.conditionalHandlers?.editElseBranch?.(
						event.detail
					);
					if (updated) {
						this.emitCommandsChanged();
					}
				}
			);
		}
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
				textComponent.inputEl.style.marginRight = "1em";
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
				dropdown.selectEl.style.marginRight = "1em";
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
					);
			})
			.addButton((button) =>
				button.setCta().setButtonText("Add").onClick(addEditorCommandFromDropdown)
			);
	}

	private renderAddUserScriptSetting(parent: HTMLElement) {
		let input!: TextComponent;
		let addButton: ButtonComponent | null = null;

		const addUserScriptFromInput = () => {
			const value: string = input.getValue();
			const scriptBasename = getUserScriptMemberAccess(value).basename;

			if (!scriptBasename) return;

			const byPath = this.javascriptFiles.find(
				(f) => f.path === scriptBasename
			);
			if (byPath) {
				this.addCommand(new UserScript(value, byPath.path));
				input.setValue("");
				if (addButton) {
					addButton.buttonEl.style.display = "none";
				}
				return;
			}

			const byName = this.javascriptFiles.filter(
				(f) => f.name === scriptBasename
			);
			if (byName.length === 1) {
				this.addCommand(new UserScript(value, byName[0].path));
				input.setValue("");
				if (addButton) {
					addButton.buttonEl.style.display = "none";
				}
				return;
			}

			const byBasename = this.javascriptFiles.filter(
				(f) => f.basename === scriptBasename
			);
			if (byBasename.length !== 1) return;

			const file = byBasename[0];
			if (!file) return;

			this.addCommand(new UserScript(value, file.path));

			input.setValue("");
			if (addButton) {
				addButton.buttonEl.style.display = "none";
			}
		};

		new Setting(parent)
			.setName("User Scripts")
			.setDesc("Add user script - type the name or click Browse")
			.addText((textComponent) => {
				input = textComponent;
				textComponent.inputEl.style.marginRight = "1em";
				textComponent.setPlaceholder("Start typing script name...");

				new GenericTextSuggester(
					this.app,
					textComponent.inputEl,
					this.javascriptFiles.map((f) => f.name)
				);

				textComponent.inputEl.addEventListener(
					"keypress",
					(e: KeyboardEvent) => {
						if (e.key === "Enter") {
							addUserScriptFromInput();
						}
					}
				);
			})
			.addButton((button) =>
				button
					.setButtonText("Browse")
					.setTooltip("Browse and select a script file")
					.onClick(async () => {
						const selected = await this.showScriptPicker();
						if (selected) {
							this.addCommand(new UserScript(selected.name, selected.path));
						}
					})
			)
			.addButton((button) => {
				addButton = button;
				button.setButtonText("Add").setCta().onClick(addUserScriptFromInput);
				button.buttonEl.style.display = "none";
			});

		input.onChange((value) => {
			if (!addButton) return;
			addButton.buttonEl.style.display = value.trim()
				? "inline-block"
				: "none";
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
				textComponent.inputEl.style.marginRight = "1em";
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

	private async showScriptPicker(): Promise<TFile | null> {
		if (this.javascriptFiles.length === 0) {
			showNoScriptsFoundNotice();
			return null;
		}

		const scriptNames = this.javascriptFiles.map((f) => f.path);
		const selected = await InputSuggester.Suggest(
			this.app,
			scriptNames,
			scriptNames,
			{
				placeholder: "Select a script file",
				emptyStateText: "No .js or .md files found in your vault",
			}
		);

		if (!selected) return null;

		return this.javascriptFiles.find((f) => f.path === selected) ?? null;
	}

	private addCommand(command: ICommand) {
		this.commandsRef.push(command);
		this.emitCommandsChanged();
	}

	private emitCommandsChanged() {
		if (this.commandListComponent) {
			// @ts-ignore Svelte exposes exported functions on instances
			this.commandListComponent.updateCommandList(this.commandsRef);
		}
		this.onCommandsChange?.(this.commandsRef);
	}
}
