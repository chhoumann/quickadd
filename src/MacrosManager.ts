import type {IMacro} from "./types/macros/IMacro";
import {App, ButtonComponent, Modal, Setting, TextComponent, ToggleComponent} from "obsidian";
import {MacroBuilder} from "./gui/MacroBuilder";
import {QuickAddMacro} from "./types/macros/QuickAddMacro";

export class MacrosManager extends Modal {
    public waitForClose: Promise<IMacro[]>;
    private resolvePromise: (macros: IMacro[]) => void;
    private rejectPromise: (reason?: any) => void;

    constructor(public app: App, private macros: IMacro[]) {
        super(app)

        this.waitForClose = new Promise<IMacro[]>(
            ((resolve, reject) => {
                this.rejectPromise = reject;
                this.resolvePromise = resolve;
            })
        );

        this.open();
        this.display();
    }

    private display(): void {
        this.contentEl.createEl('h2', {text: 'Macro Manager'}).style.textAlign = "center";
        this.addMacroSettings();
        this.addAddMacroBar();
    }

    private addMacroSettings() {
        const macroContainer: HTMLDivElement = this.contentEl.createDiv();
        macroContainer.addClass('macroContainer');
        this.macros.forEach(macro => this.addMacroSetting(macro, macroContainer));
    }

    private addMacroSetting(macro: IMacro, container: HTMLDivElement) {
        const configureMacroContainer = container.createDiv();

        const macroSetting: Setting = new Setting(configureMacroContainer);
        macroSetting.setName(macro.name);
        macroSetting.infoEl.style.fontWeight = "bold";

        this.addMacroConfigurationItem(configureMacroContainer, itemContainerEl => {
            this.addSpanWithText(itemContainerEl, "Run on Startup");

            const toggle: ToggleComponent = new ToggleComponent(itemContainerEl);
            toggle.setValue(macro.runOnStartup);

            toggle.onChange(value => {
                macro.runOnStartup = value;

                this.updateMacro(macro);
            });
        });

        configureMacroContainer.addClass("configureMacroDiv");
        this.addMacroConfigurationItem(configureMacroContainer, itemContainerEl => {
            const configureButton: ButtonComponent = new ButtonComponent(itemContainerEl);
            configureButton.setClass('mod-cta');
            configureButton.buttonEl.style.marginRight = "0";

            configureButton.setButtonText("Configure").onClick(async evt => {
                const newMacro = await new MacroBuilder(this.app, macro).waitForClose;

                if (newMacro) {
                    this.updateMacro(newMacro);
                    this.reload();
                }
            });

            const deleteButton: ButtonComponent = new ButtonComponent(itemContainerEl);
            deleteButton.setClass('mod-danger');
            deleteButton.buttonEl.style.marginRight = "0";

            deleteButton.setButtonText("Delete").onClick(evt => {
                this.macros = this.macros.filter(m => m.id !== macro.id);
                this.reload();
            });
        });

    }

    private addMacroConfigurationItem(container: HTMLDivElement, callback: (itemContainerEl) => void, classString: string = "configureMacroDivItem") {
        const item: HTMLDivElement = container.createDiv();
        item.addClass(classString);

        callback(item);
    }

    private addSpanWithText(container: HTMLDivElement, text: string) {
        const configureText: HTMLSpanElement = container.createEl('span');
        configureText.setText(text);
    }

    private updateMacro(macro: IMacro) {
        const index = this.macros.findIndex(v => v.id === macro.id);
        this.macros[index] = macro;
        this.reload();
    }

    private reload(): void {
        this.contentEl.empty();
        this.display();
    }

    private addAddMacroBar() {
        const addMacroBarContainer: HTMLDivElement = this.contentEl.createDiv();
        addMacroBarContainer.addClass("addMacroBarContainer");

        const nameInput: TextComponent = new TextComponent(addMacroBarContainer);
        nameInput.setPlaceholder("Macro name");

        const addMacroButton: ButtonComponent = new ButtonComponent(addMacroBarContainer);
        addMacroButton.setButtonText("Add macro")
            .setClass("mod-cta")
            .onClick(() => {
                const inputValue = nameInput.getValue();

                if (inputValue !== "" && !this.macros.find(m => m.name === inputValue)) {
                    this.macros.push(new QuickAddMacro(inputValue));
                    this.reload();
                }
            })
    }

    onClose() {
        super.onClose();
        this.resolvePromise(this.macros);
    }
}