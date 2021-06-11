import {ChoiceBuilder} from "./choiceBuilder";
import type IMacroChoice from "../../types/choices/IMacroChoice";
import type {App} from "obsidian";
import {Setting, TFile} from "obsidian";
import {GenericTextSuggester} from "../genericTextSuggester";
import type {IObsidianCommand} from "../../types/macros/IObsidianCommand";
import {ObsidianCommand} from "../../types/macros/ObsidianCommand";
import {JAVASCRIPT_FILE_EXTENSION_REGEX} from "../../constants";
import {UserScript} from "../../types/macros/UserScript";
import CommandList from "./CommandList.svelte";

export class MacroChoiceBuilder extends ChoiceBuilder {
    choice: IMacroChoice;
    private commands: IObsidianCommand[] = [];
    private javascriptFiles: TFile[] = [];
    private commandListEl: CommandList;

    constructor(app: App, choice: IMacroChoice) {
        super(app);
        this.choice = choice;

        this.getObsidianCommands();
        this.getJavascriptFiles();

        this.display();
    }

    protected display() {
        this.addCenteredHeader(this.choice.name);
        this.addCommandList();
        this.addAddObsidianCommandSetting();
        this.addAddUserScriptSetting();
    }

    private addAddObsidianCommandSetting() {
        new Setting(this.contentEl)
            .setName("Obsidian command")
            .setDesc("Add an Obsidian command")
            .addSearch(searchComponent => {
                searchComponent.setPlaceholder("Obsidian command");
                new GenericTextSuggester(this.app, searchComponent.inputEl, this.commands.map(c => c.name));

                searchComponent.inputEl.addEventListener('keypress', (e: KeyboardEvent) => {
                    if (e.key === 'Enter') {
                        const value: string = searchComponent.getValue();
                        const command: IObsidianCommand = this.commands.find(v => v.name === value);

                        this.choice.macro.commands.push(command);
                        this.commandListEl.updateCommandList(this.choice.macro.commands);

                        searchComponent.setValue("");
                    }
                });
            });
    }

    private addAddUserScriptSetting() {
        new Setting(this.contentEl)
            .setName("User Scripts")
            .setDesc("Add user script")
            .addSearch(searchComponent => {
                searchComponent.setPlaceholder("User script");
                new GenericTextSuggester(this.app, searchComponent.inputEl, this.javascriptFiles.map(f => f.basename));

                searchComponent.inputEl.addEventListener('keypress', (e: KeyboardEvent) => {
                    if (e.key === 'Enter') {
                        const value: string = searchComponent.getValue();
                        const file = this.javascriptFiles.find(f => f.basename === value);
                        if (!file) return;

                        this.choice.macro.commands.push(new UserScript(value, file.path));
                        this.commandListEl.updateCommandList(this.choice.macro.commands);

                        searchComponent.setValue("");
                    }
                })
            })
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
                commands: this.choice.macro.commands,
                deleteFolder: (command: string) => {
                    this.choice.macro.commands = this.choice.macro.commands.filter(c => c.name !== command);
                    this.commandListEl.updateCommandList(this.choice.macro.commands);
                }
            }
        });

        this.svelteElements.push(this.commandListEl);
    }
}