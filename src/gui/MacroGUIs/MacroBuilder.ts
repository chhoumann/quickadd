import type { IMacro } from "../../types/macros/IMacro";
import type { App, DropdownComponent, TextComponent, TFile } from "obsidian";
import { ButtonComponent, Modal, Setting } from "obsidian";
import type { IObsidianCommand } from "../../types/macros/IObsidianCommand";
import { UserScript } from "../../types/macros/UserScript";
import { ObsidianCommand } from "../../types/macros/ObsidianCommand";
import { JAVASCRIPT_FILE_EXTENSION_REGEX } from "../../constants";
import type { ICommand } from "../../types/macros/ICommand";
import type { SvelteComponent } from "svelte";
import CommandList from "./CommandList.svelte";
import type IChoice from "../../types/choices/IChoice";
import { ChoiceCommand } from "../../types/macros/ChoiceCommand";
import { getUserScriptMemberAccess } from "../../utilityObsidian";
import GenericInputPrompt from "../GenericInputPrompt/GenericInputPrompt";
import { WaitCommand } from "../../types/macros/QuickCommands/WaitCommand";
import { CaptureChoice } from "../../types/choices/CaptureChoice";
import { NestedChoiceCommand } from "../../types/macros/QuickCommands/NestedChoiceCommand";
import { TemplateChoice } from "../../types/choices/TemplateChoice";
import type QuickAdd from "../../main";
import type { IEditorCommand } from "../../types/macros/EditorCommands/IEditorCommand";
import { EditorCommandType } from "../../types/macros/EditorCommands/EditorCommandType";
import { CopyCommand } from "../../types/macros/EditorCommands/CopyCommand";
import { CutCommand } from "../../types/macros/EditorCommands/CutCommand";
import { PasteCommand } from "../../types/macros/EditorCommands/PasteCommand";
import { log } from "../../logger/logManager";
import { SelectActiveLineCommand } from "../../types/macros/EditorCommands/SelectActiveLineCommand";
import { SelectLinkOnActiveLineCommand } from "../../types/macros/EditorCommands/SelectLinkOnActiveLineCommand";
import GenericYesNoPrompt from "../GenericYesNoPrompt/GenericYesNoPrompt";
import { GenericTextSuggester } from "../suggesters/genericTextSuggester";
import type { MultiChoice } from "src/types/choices/MultiChoice";
import type { IconType } from "src/types/IconType";
import { AIAssistantCommand } from "src/types/macros/QuickCommands/AIAssistantCommand";
import { settingsStore } from "src/settingsStore";
import InputSuggester from "../InputSuggester/inputSuggester";

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
	public macro: IMacro;
	public waitForClose: Promise<IMacro>;
	private commands: IObsidianCommand[] = [];
	private javascriptFiles: TFile[] = [];
	private readonly choices: IChoice[] = [];
	private commandListEl: CommandList;
	private svelteElements: SvelteComponent[];
	private resolvePromise: (macro: IMacro) => void;
	private plugin: QuickAdd;

	constructor(app: App, plugin: QuickAdd, macro: IMacro, choices: IChoice[]) {
		super(app);
		this.macro = macro;
		this.svelteElements = [];
		this.choices = getChoicesAsList(choices);
		this.plugin = plugin;

		this.waitForClose = new Promise<IMacro>(
			(resolve) => (this.resolvePromise = resolve)
		);

		this.getObsidianCommands();
		this.getJavascriptFiles();

		this.display();
		this.open();
	}

	onClose() {
		super.onClose();
		this.resolvePromise(this.macro);
		this.svelteElements.forEach((el) => {
			if (el && el.$destroy) el.$destroy();
		});
	}

	protected display() {
		this.containerEl.addClass("quickAddModal", "macroBuilder");
		this.contentEl.empty();
		this.addCenteredHeader(this.macro.name);
		this.addCommandList();
		this.addCommandBar();
		this.addAddObsidianCommandSetting();
		this.addAddEditorCommandsSetting();
		this.addAddUserScriptSetting();
		this.addAddChoiceSetting();
	}

	protected addCenteredHeader(header: string): void {
		const headerEl = this.contentEl.createEl("h2");
		headerEl.style.textAlign = "center";
		headerEl.setText(header);
		headerEl.addClass("clickable");

		 
		headerEl.addEventListener("click", async () => {
			const newMacroName: string = await GenericInputPrompt.Prompt(
				this.app,
				`Update name for ${this.macro.name}`,
				this.macro.name
			);
			if (!newMacroName) return;

			this.macro.name = newMacroName;
			this.reload();
		});
	}

	private reload() {
		this.display();
	}

	private addAddObsidianCommandSetting() {
		let input: TextComponent;

		const addObsidianCommandFromInput = () => {
			const value: string = input.getValue();
			const obsidianCommand = this.commands.find((v) => v.name === value);

			if (!obsidianCommand) {
				log.logError(
					`Could not find Obsidian command with name "${value}"`
				);
				return;
			}

			const command = new ObsidianCommand(
				obsidianCommand.name,
				obsidianCommand.commandId
			);
			command.generateId();

			this.addCommandToMacro(command);

			input.setValue("");
		};

		new Setting(this.contentEl)
			.setName("Obsidian command")
			.setDesc("Add an Obsidian command")
			.addText((textComponent) => {
				input = textComponent;
				textComponent.inputEl.style.marginRight = "1em";
				textComponent.setPlaceholder("Obsidian command");
				new GenericTextSuggester(
					this.app,
					textComponent.inputEl,
					this.commands.map((c) => c.name)
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
				button
					.setCta()
					.setButtonText("Add")
					.onClick(addObsidianCommandFromInput)
			);
	}

	private addAddEditorCommandsSetting() {
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

			this.addCommandToMacro(command);
		};

		new Setting(this.contentEl)
			.setName("Editor commands")
			.setDesc("Add editor command")
			.addDropdown((dropdown) => {
				dropdownComponent = dropdown;
				dropdown.selectEl.style.marginRight = "1em";
				dropdown
					.addOption(EditorCommandType.Copy, EditorCommandType.Copy)
					.addOption(EditorCommandType.Cut, EditorCommandType.Cut)
					.addOption(EditorCommandType.Paste, EditorCommandType.Paste)
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
				button
					.setCta()
					.setButtonText("Add")
					.onClick(addEditorCommandFromDropdown)
			);
	}

	private addAddUserScriptSetting() {
		let input: TextComponent;
		let addButton: ButtonComponent;

		const addUserScriptFromInput = () => {
			const value: string = input.getValue();
			const scriptBasename = getUserScriptMemberAccess(value).basename;

			const file = this.javascriptFiles.find(
				(f) => f.basename === scriptBasename
			);
			if (!file) return;

			this.addCommandToMacro(new UserScript(value, file.path));

			input.setValue("");
			// Ensure Add button is hidden after clearing input
			addButton.buttonEl.style.display = 'none';
		};

		new Setting(this.contentEl)
			.setName("User Scripts")
			.setDesc("Add user script - type the name or click Browse")
			.addText((textComponent) => {
				input = textComponent;
				textComponent.inputEl.style.marginRight = "1em";
				textComponent.setPlaceholder("Start typing script name...");
				
				new GenericTextSuggester(
					this.app,
					textComponent.inputEl,
					this.javascriptFiles.map((f) => f.basename)
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
			.addButton((button) => {
				button
					.setButtonText("Browse")
					.setTooltip("Browse and select a script file")
					.onClick(async () => {
						const selected = await this.showScriptPicker();
						if (selected) {
							this.addCommandToMacro(new UserScript(selected.basename, selected.path));
						}
					});
			})
			.addButton((button) => {
				addButton = button;
				button
					.setButtonText("Add")
					.setCta()
					.onClick(addUserScriptFromInput);
				// Initially hidden
				button.buttonEl.style.display = 'none';
				
				// Set up onChange handler after both input and addButton are initialized
				input.onChange((value) => {
					addButton.buttonEl.style.display = value.trim() ? 'inline-block' : 'none';
				});
			});
	}

	private addAddChoiceSetting() {
		let input: TextComponent;

		const addChoiceFromInput = () => {
			const value: string = input.getValue();
			const choice = this.choices.find((c) => c.name === value);
			if (!choice) return;

			this.addCommandToMacro(new ChoiceCommand(choice.name, choice.id));

			input.setValue("");
		};

		new Setting(this.contentEl)
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

				textComponent.inputEl.addEventListener(
					"keypress",
					(e: KeyboardEvent) => {
						if (e.key === "Enter") {
							addChoiceFromInput();
						}
					}
				);
			})
			.addButton((button) =>
				button.setCta().setButtonText("Add").onClick(addChoiceFromInput)
			);
	}

	private getObsidianCommands(): void {
		// @ts-ignore
		Object.keys(this.app.commands.commands).forEach((key) => {
			// @ts-ignore
			const command: { name: string; id: string } =
				this.app.commands.commands[key];

			this.commands.push(new ObsidianCommand(command.name, command.id));
		});
	}

	private getJavascriptFiles(): void {
		this.javascriptFiles = this.app.vault
			.getFiles()
			.filter((file) => JAVASCRIPT_FILE_EXTENSION_REGEX.test(file.path));
	}

	private addCommandList() {
		const commandList = this.contentEl.createDiv("commandList");

		this.commandListEl = new CommandList({
			target: commandList,
			props: {
				app: this.app,
				plugin: this.plugin,
				commands: this.macro.commands,
				deleteCommand: async (commandId: string) => {
					const command = this.macro.commands.find(
						(c) => c.id === commandId
					);

					if (!command) {
						log.logError("command not found");
						throw new Error("command not found");
					}

					const promptAnswer: boolean =
						await GenericYesNoPrompt.Prompt(
							this.app,
							"Are you sure you wish to delete this command?",
							`If you click yes, you will delete '${command.name}'.`
						);
					if (!promptAnswer) return;

					this.macro.commands = this.macro.commands.filter(
						(c) => c.id !== commandId
					);
					//@ts-ignore
					 
					this.commandListEl.updateCommandList(this.macro.commands);
				},
				saveCommands: (commands: ICommand[]) => {
					this.macro.commands = commands;
				},
			},
		});

		this.svelteElements.push(this.commandListEl);
	}

	private addCommandBar() {
		const quickCommandContainer: HTMLDivElement = this.contentEl.createDiv(
			"quickCommandContainer"
		);

		this.newChoiceButton(quickCommandContainer, "Capture", CaptureChoice);
		this.newChoiceButton(quickCommandContainer, "Template", TemplateChoice);
		this.addAddWaitCommandButton(quickCommandContainer);

		if (!settingsStore.getState().disableOnlineFeatures) {
			this.addAIAssistantCommandButton(quickCommandContainer);
		}
	}
	addAIAssistantCommandButton(quickCommandContainer: HTMLDivElement) {
		const button: ButtonComponent = new ButtonComponent(
			quickCommandContainer
		);

		button
			.setIcon("bot" as IconType)
			.setTooltip("Add AI Assistant command")
			.onClick(() => {
				this.addCommandToMacro(new AIAssistantCommand());
			});
	}

	private addAddWaitCommandButton(quickCommandContainer: HTMLDivElement) {
		const button: ButtonComponent = new ButtonComponent(
			quickCommandContainer
		);
		button
			.setIcon("clock")
			.setTooltip("Add wait command")
			.onClick(() => {
				this.addCommandToMacro(new WaitCommand(100));
			});
	}

	private newChoiceButton(
		container: HTMLDivElement,
		typeName: string,
		type: typeof TemplateChoice | typeof CaptureChoice
	) {
		const button: ButtonComponent = new ButtonComponent(container);
		button
			.setButtonText(typeName)
			.setTooltip(`Add ${typeName} Choice`)
			.onClick(() => {
				const captureChoice: IChoice = new type(
					`Untitled ${typeName} Choice`
				);
				this.addCommandToMacro(new NestedChoiceCommand(captureChoice));
			});
	}

	private async showScriptPicker(): Promise<TFile | null> {
		if (this.javascriptFiles.length === 0) {
			return null;
		}

		const scriptNames = this.javascriptFiles.map(f => f.basename);
		const selected = await InputSuggester.Suggest(
			this.app,
			scriptNames,
			scriptNames,
			{ 
				placeholder: "Select a JavaScript file",
				emptyStateText: "No .js files found in your vault"
			}
		);
		
		if (!selected) return null;
		
		return this.javascriptFiles.find(f => f.basename === selected) ?? null;
	}

	private addCommandToMacro(command: ICommand) {
		this.macro.commands.push(command);
		//@ts-ignore
		 
		this.commandListEl.updateCommandList(this.macro.commands);
	}
}
