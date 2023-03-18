import { ChoiceBuilder } from "./choiceBuilder";
import type IMacroChoice from "../../types/choices/IMacroChoice";
import { App, ButtonComponent } from "obsidian";
import { DropdownComponent } from "obsidian";
import type { IMacro } from "../../types/macros/IMacro";
import { MacroBuilder } from "../MacroGUIs/MacroBuilder";
import QuickAdd from "src/main";
import { settingsStore } from "src/settingsStore";
import IChoice from "src/types/choices/IChoice";
import { log } from "src/logger/logManager";

export class MacroChoiceBuilder extends ChoiceBuilder {
	choice: IMacroChoice;
	private macros: IMacro[];
	private choices: IChoice[];

	private unsubscribe: () => void;

	constructor(
		app: App,
		choice: IMacroChoice,
		macros: IMacro[],
		choices: IChoice[]
	) {
		super(app);
		this.choice = choice;
		this.macros = macros;
		this.choices = choices;

		this.unsubscribe = settingsStore.subscribe((newSettings) => {
			this.macros = newSettings.macros;
			this.choices = newSettings.choices;

			this.reload();
		});

		this.display();
	}

	onClose(): void {
		this.unsubscribe();
	}

	protected display() {
		this.containerEl.addClass("macroChoiceBuilder");
		this.addCenteredChoiceNameHeader(this.choice);
		const macroDropdownContainer = this.contentEl.createDiv();
		macroDropdownContainer.addClass("macroDropdownContainer");

		this.addSelectMacroSearch(macroDropdownContainer);

		const buttonsContainer = macroDropdownContainer.createDiv();
		buttonsContainer.addClass("macro-choice-buttonsContainer");

		this.addConfigureMacroButton(buttonsContainer);
		this.addCreateMacroButton(buttonsContainer);
	}

	addCreateMacroButton(container: HTMLElement) {
		const hasOwnMacro =
			settingsStore.getMacro(this.choice.macroId)?.name ===
			this.choice.name;

		if (hasOwnMacro) return;

		const createMacroButtonContainer = container.createDiv();
		const createMacroButton = new ButtonComponent(
			createMacroButtonContainer
		);
		createMacroButton
			.setIcon("plus")
			.setCta()
			.setTooltip("Create Macro")
			.onClick(async () => {
				try {
					const macro = settingsStore.createMacro(this.choice.name);
					this.choice.macroId = macro.id;
					this.reload();
				} catch (error) {
					log.logError(error);
				}
			});
	}

	private addConfigureMacroButton(container: HTMLElement) {
		const configureMacroButtonContainer = container.createDiv();
		const configureMacroButton = new ButtonComponent(
			configureMacroButtonContainer
		);
		configureMacroButton
			.setIcon("cog")
			.setTooltip("Configure Macro")
			.onClick(async () => {
				const macro = this.macros.find(
					(m) => m.id === this.choice.macroId
				);
				if (!macro)
					return log.logError("Could not find macro to configure");

				const builder = new MacroBuilder(
					app,
					QuickAdd.instance,
					macro,
					this.choices
				);
				const newMacro = await builder.waitForClose;

				settingsStore.setMacro(this.choice.macroId, newMacro);
			});
	}

	private addSelectMacroSearch(container: HTMLElement) {
		const selectMacroDropdownContainer: HTMLDivElement =
			container.createDiv("selectMacroDropdownContainer");
		const dropdown: DropdownComponent = new DropdownComponent(
			selectMacroDropdownContainer
		);

		const macroOptions: Record<string, string> = {};

		this.macros.forEach((macro) => {
			macroOptions[macro.name] = macro.name;
		});

		dropdown.addOptions(macroOptions);
		dropdown.onChange((value) => {
			this.selectMacro(value);
		});

		const selectedMacro = this.macros.find(
			(m) => m.id === this.choice.macroId
		);
		if (selectedMacro) {
			dropdown.setValue(selectedMacro.name);
		} else {
			const value = dropdown.getValue();
			if (value) {
				this.selectMacro(value);
			}
		}
	}

	private selectMacro(value: string) {
		const targetMacro = this.macros.find((m) => m.name === value);
		if (!targetMacro) return;

		this.choice.macroId = targetMacro.id;
	}
}
