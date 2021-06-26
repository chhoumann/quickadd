import type {IMacro} from "../../types/macros/IMacro";
import {App, ButtonComponent, Modal, SearchComponent, Setting, TextComponent, TFile} from "obsidian";
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

export class MacroBuilder extends Modal {
    public macro: IMacro;
    public waitForClose: Promise<IMacro>;
    private commands: IObsidianCommand[] = [];
    private javascriptFiles: TFile[] = [];
    private readonly choices: IChoice[] = [];
    private commandListEl: CommandList;
    private svelteElements: SvelteComponent[];
    private resolvePromise: (macro: IMacro) => void;

    constructor(app: App, macro: IMacro, choices: IChoice[]) {
        super(app);
        this.macro = macro;
        this.svelteElements = [];
        this.choices = choices;

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
        this.addAddWaitCommandButton();
        this.addAddObsidianCommandSetting();
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
            .setDesc("Add choice")
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

    private addAddWaitCommandButton() {
        const quickCommandContainer: HTMLDivElement = this.contentEl.createDiv('quickCommandContainer');

        const button: ButtonComponent = new ButtonComponent(quickCommandContainer);
        button.setIcon('clock').setTooltip("Add wait command").onClick(() => {
            this.addCommandToMacro(new WaitCommand(100));
        });
    }

    private addCommandToMacro(command: ICommand) {
        this.macro.commands.push(command);
        this.commandListEl.updateCommandList(this.macro.commands);
    }
}
