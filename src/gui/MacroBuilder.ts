import type {IMacro} from "../types/macros/IMacro";
import {App, Modal, Setting, TFile} from "obsidian";
import type {IObsidianCommand} from "../types/macros/IObsidianCommand";
import {GenericTextSuggester} from "./genericTextSuggester";
import {UserScript} from "../types/macros/UserScript";
import {ObsidianCommand} from "../types/macros/ObsidianCommand";
import {JAVASCRIPT_FILE_EXTENSION_REGEX} from "../constants";
import type {ICommand} from "../types/macros/ICommand";
import type {SvelteComponent} from "svelte";
import CommandList from "./CommandList.svelte"

export class MacroBuilder extends Modal {
    public macro: IMacro;
    public waitForClose: Promise<IMacro>;
    private commands: IObsidianCommand[] = [];
    private javascriptFiles: TFile[] = [];
    private commandListEl: CommandList;
    private svelteElements: SvelteComponent[];
    private resolvePromise: (macro: IMacro) => void;

    constructor(app: App, macro: IMacro) {
        super(app);
        this.macro = macro;
        this.svelteElements = [];

        this.waitForClose = new Promise<IMacro>(resolve => (this.resolvePromise = resolve));

        this.getObsidianCommands();
        this.getJavascriptFiles();

        this.display();
        this.open();
    }

    protected display() {
        this.addCenteredHeader(this.macro.name);
        this.addCommandList();
        this.addAddObsidianCommandSetting();
        this.addAddUserScriptSetting();
    }

    protected addCenteredHeader(header: string): void {
        const headerEl = this.contentEl.createEl('h2');
        headerEl.style.textAlign = "center";
        headerEl.setText(header);
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

                        this.macro.commands.push(command);
                        this.commandListEl.updateCommandList(this.macro.commands);

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

                        this.macro.commands.push(new UserScript(value, file.path));
                        this.commandListEl.updateCommandList(this.macro.commands);

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
                commands: this.macro.commands,
                deleteCommand: (command: ICommand) => {
                    this.macro.commands = this.macro.commands.filter(c => c.id !== command.id);
                    this.commandListEl.updateCommandList(this.macro.commands);
                }
            }
        });

        this.svelteElements.push(this.commandListEl);
    }

    onClose() {
        super.onClose();
        this.resolvePromise(this.macro);
        this.svelteElements.forEach(el => {
            if (el && el.$destroy) el.$destroy();
        })
    }
}
