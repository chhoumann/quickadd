import type {IMacro} from "../../types/macros/IMacro";
import {App, ButtonComponent, DropdownComponent, Modal, Setting, TextComponent, TFile} from "obsidian";
import type {IObsidianCommand} from "../../types/macros/IObsidianCommand";
import {GenericTextSuggester} from "../genericTextSuggester";
import {UserScript} from "../../types/macros/UserScript";
import {ObsidianCommand} from "../../types/macros/ObsidianCommand";
import {JAVASCRIPT_FILE_EXTENSION_REGEX} from "../../constants";
import type {ICommand} from "../../types/macros/ICommand";
import type {SvelteComponent} from "svelte";
import CommandList from "./CommandList.svelte"
import type IChoice from "../../types/choices/IChoice";
import {Choice} from "../../types/choices/Choice";
import {ChoiceCommand} from "../../types/macros/ChoiceCommand";
import {getUserScriptMemberAccess} from "../../utility";
import GenericInputPrompt from "../GenericInputPrompt/genericInputPrompt";
import {WaitCommand} from "../../types/macros/QuickCommands/WaitCommand";
import {CaptureChoice} from "../../types/choices/CaptureChoice";
import {NestedChoiceCommand} from "../../types/macros/QuickCommands/NestedChoiceCommand";
import {TemplateChoice} from "../../types/choices/TemplateChoice";
import type QuickAdd from "../../main";
import type {IEditorCommand} from "../../types/macros/EditorCommands/IEditorCommand";
import {EditorCommandType} from "../../types/macros/EditorCommands/EditorCommandType";
import {CopyCommand} from "../../types/macros/EditorCommands/CopyCommand";
import {CutCommand} from "../../types/macros/EditorCommands/CutCommand";
import {PasteCommand} from "../../types/macros/EditorCommands/PasteCommand";
import {log} from "../../logger/logManager";
import {EditorCommand} from "../../types/macros/EditorCommands/EditorCommand";
import {SelectActiveLineCommand} from "../../types/macros/EditorCommands/SelectActiveLineCommand";
import {SelectLinkOnActiveLineCommand} from "../../types/macros/EditorCommands/SelectLinkOnActiveLineCommand";

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
        this.choices = choices;
        this.plugin = plugin;

        this.waitForClose = new Promise<IMacro>(resolve => (this.resolvePromise = resolve));

        this.getObsidianCommands();
        this.getJavascriptFiles();

        this.display();
        this.open();
    }

    onClose() {
        super.onClose();
        this.resolvePromise(this.macro);
        this.svelteElements.forEach(el => {
            if (el && el.$destroy) el.$destroy();
        })
    }

    protected display() {
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
        const headerEl = this.contentEl.createEl('h2');
        headerEl.style.textAlign = "center";
        headerEl.setText(header);
        headerEl.addClass('clickable');

        headerEl.addEventListener('click', async () => {
            const newMacroName: string = await GenericInputPrompt.Prompt(this.app, `Update name for ${this.macro.name}`, this.macro.name);
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
            const command: IObsidianCommand = this.commands.find(v => v.name === value);

            this.addCommandToMacro(command);

            input.setValue("");
        }

        new Setting(this.contentEl)
            .setName("Obsidian command")
            .setDesc("Add an Obsidian command")
            .addText(textComponent => {
                input = textComponent;
                textComponent.inputEl.style.marginRight = "1em";
                textComponent.setPlaceholder("Obsidian command");
                new GenericTextSuggester(this.app, textComponent.inputEl, this.commands.map(c => c.name));

                textComponent.inputEl.addEventListener('keypress', (e: KeyboardEvent) => {
                    if (e.key === 'Enter') {
                        addObsidianCommandFromInput();
                    }
                });
            })
            .addButton(button => button.setCta().setButtonText("Add").onClick(addObsidianCommandFromInput));
    }
    
    private addAddEditorCommandsSetting() {
        let dropdownComponent: DropdownComponent;

        const addEditorCommandFromDropdown = () => {
            const type: EditorCommandType = dropdownComponent.getValue() as EditorCommandType;
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
            }

            this.addCommandToMacro(command);
        }

        new Setting(this.contentEl)
            .setName("Editor commands")
            .setDesc("Add editor command")
            .addDropdown(dropdown => {
                dropdownComponent = dropdown;
                dropdown.selectEl.style.marginRight = "1em";
                dropdown.addOption(EditorCommandType.Copy, EditorCommandType.Copy)
                    .addOption(EditorCommandType.Cut, EditorCommandType.Cut)
                    .addOption(EditorCommandType.Paste, EditorCommandType.Paste)
                    .addOption(EditorCommandType.SelectActiveLine, EditorCommandType.SelectActiveLine)
                    .addOption(EditorCommandType.SelectLinkOnActiveLine, EditorCommandType.SelectLinkOnActiveLine);
            })
            .addButton(button => button.setCta().setButtonText("Add").onClick(addEditorCommandFromDropdown));
    }

    private addAddUserScriptSetting() {
        let input: TextComponent;

        const addUserScriptFromInput = () => {
            const value: string = input.getValue();
            const scriptBasename = getUserScriptMemberAccess(value).basename;

            const file = this.javascriptFiles.find(f => f.basename === scriptBasename);
            if (!file) return;

            this.addCommandToMacro(new UserScript(value, file.path));

            input.setValue("");
        }

        new Setting(this.contentEl)
            .setName("User Scripts")
            .setDesc("Add user script")
            .addText(textComponent => {
                input = textComponent;
                textComponent.inputEl.style.marginRight = "1em";
                textComponent.setPlaceholder("User script");
                new GenericTextSuggester(this.app, textComponent.inputEl, this.javascriptFiles.map(f => f.basename));

                textComponent.inputEl.addEventListener('keypress', (e: KeyboardEvent) => {
                    if (e.key === 'Enter') {
                        addUserScriptFromInput();
                    }
                })
            })
            .addButton(button => button
                .setButtonText("Add")
                .setCta()
                .onClick(addUserScriptFromInput)
            );
    }

    private addAddChoiceSetting() {
        let input: TextComponent;

        const addChoiceFromInput = () => {
            const value: string = input.getValue();
            const choice = this.choices.find(c => c.name === value);
            if (!choice) return;

            this.addCommandToMacro(new ChoiceCommand(choice.name, choice.id))

            input.setValue("");
        }

        new Setting(this.contentEl)
            .setName("Choices")
            .setDesc("Add existing choice")
            .addText(textComponent => {
               input = textComponent;
               textComponent.inputEl.style.marginRight = "1em";
               textComponent.setPlaceholder("Choice");
               new GenericTextSuggester(this.app, textComponent.inputEl, this.choices.map(c => c.name));

               textComponent.inputEl.addEventListener('keypress', (e: KeyboardEvent) => {
                   if (e.key === 'Enter') {
                       addChoiceFromInput();
                   }
               })
            })
            .addButton(button => button.setCta()
                .setButtonText("Add")
                .onClick(addChoiceFromInput)
            );
    }

    private getObsidianCommands(): void {
        // @ts-ignore
        Object.keys(this.app.commands.commands).forEach(key => {
            // @ts-ignore
            const command = this.app.commands.commands[key];

            this.commands.push(new ObsidianCommand(command.name, command.id));
        })
    }

    private getJavascriptFiles(): void {
        this.javascriptFiles = this.app.vault.getFiles()
            .filter(file => JAVASCRIPT_FILE_EXTENSION_REGEX.test(file.path));
    }

    private addCommandList() {
        const commandList = this.contentEl.createDiv('commandList');

        this.commandListEl = new CommandList({
            target: commandList,
            props: {
                app: this.app,
                plugin: this.plugin,
                commands: this.macro.commands,
                deleteCommand: (commandId: string) => {
                    this.macro.commands = this.macro.commands.filter(c => c.id !== commandId);
                    this.commandListEl.updateCommandList(this.macro.commands);
                },
                saveCommands: (commands: ICommand[]) => {
                    this.macro.commands = commands;
                },
            }
        });

        this.svelteElements.push(this.commandListEl);
    }

    private addCommandBar() {
        const quickCommandContainer: HTMLDivElement = this.contentEl.createDiv('quickCommandContainer');

        this.newChoiceButton(quickCommandContainer, "Capture", CaptureChoice);
        this.newChoiceButton(quickCommandContainer, "Template", TemplateChoice);
        this.addAddWaitCommandButton(quickCommandContainer);
    }

    private addAddWaitCommandButton(quickCommandContainer: HTMLDivElement) {
        const button: ButtonComponent = new ButtonComponent(quickCommandContainer);
        button.setIcon('clock').setTooltip("Add wait command").onClick(() => {
            this.addCommandToMacro(new WaitCommand(100));
        });
    }

    private newChoiceButton(container: HTMLDivElement, typeName: string, type: any) {
        const button: ButtonComponent = new ButtonComponent(container);
        button.setButtonText(typeName).setTooltip(`Add ${typeName} Choice`).onClick(() => {
            const captureChoice: IChoice = new type(`Untitled ${typeName} Choice`);
            this.addCommandToMacro(new NestedChoiceCommand(captureChoice));
        })
    }

    private addCommandToMacro(command: ICommand) {
        this.macro.commands.push(command);
        this.commandListEl.updateCommandList(this.macro.commands);
    }
}
