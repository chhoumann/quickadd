import {App, Modal, Setting} from "obsidian";
import type {IUserScript} from "../../types/macros/IUserScript";

export class UserScriptSettingsModal extends Modal {
    constructor(app: App, private command: IUserScript, private settings: {[key: string]: any}) {
        super(app);

        this.display();
        if (!this.command.settings) this.command.settings = {};

        Object.keys(this.settings.options).forEach(setting => {
            if (this.command.settings[setting] === undefined) {
                this.command.settings[setting] = this.settings.options[setting]?.defaultValue;
            }
        })
    }

    protected display() {
        this.contentEl.empty();

        this.titleEl.innerText = `${this.settings?.name} by ${this.settings?.author}`;
        const options = this.settings.options;

        Object.keys(options).forEach(option => {
            const entry = options[option];
            let value = entry.defaultValue;

            if (this.command.settings[option] !== undefined) {
                value = this.command.settings[option];
            }

            switch (options[option].type.toLowerCase()) {
                case "text":
                case "input":
                    this.addInputBox(option, value, entry?.placeholder);
                    break;
                case "checkbox":
                case "toggle":
                    this.addToggle(option, value);
                    break;
                case "dropdown":
                case "select":
                    this.addDropdown(option, entry.options, value);
                    break;
                default:
                    break;
            }
        });
    }

    private addInputBox(name: string, value: string, placeholder?: string) {
        new Setting(this.contentEl)
            .setName(name)
            .addText(input => {
                input.setValue(value)
                    .onChange(value => this.command.settings[name] = value)
                    .setPlaceholder(placeholder ?? "")
            });
    }

    private addToggle(name: string, value: boolean) {
        new Setting(this.contentEl)
            .setName(name)
            .addToggle(toggle =>
                toggle.setValue(value)
                    .onChange(value => this.command.settings[name] = value)
            );
    }

    private addDropdown(name: string, options: string[], value: string) {
        new Setting(this.contentEl)
            .setName(name)
            .addDropdown(dropdown => {
                options.forEach(item => dropdown.addOption(item, item));
                dropdown.setValue(value);
                dropdown.onChange(value => this.command.settings[name] = value);
            })
    }
}