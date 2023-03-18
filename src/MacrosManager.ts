import type { IMacro } from "./types/macros/IMacro";
import {
	App,
	ButtonComponent,
	Modal,
	Setting,
	TextComponent,
	ToggleComponent,
} from "obsidian";
import { MacroBuilder } from "./gui/MacroGUIs/MacroBuilder";
import { log } from "./logger/logManager";
import type IChoice from "./types/choices/IChoice";
import { ChoiceType } from "./types/choices/choiceType";
import type IMultiChoice from "./types/choices/IMultiChoice";
import type QuickAdd from "./main";
import { settingsStore } from "./settingsStore";

export class MacrosManager extends Modal {
	public waitForClose: Promise<IMacro[]>;
	private resolvePromise: (macros: IMacro[]) => void;
	private rejectPromise: (reason?: unknown) => void;
	private updateMacroContainer: () => void;
	private unsubscribe: () => void;

	private macroContainer: HTMLDivElement;
	private plugin: QuickAdd;

	constructor(
		public app: App,
		plugin: QuickAdd,
		private macros: IMacro[],
		private choices: IChoice[]
	) {
		super(app);
		this.plugin = plugin;

		this.waitForClose = new Promise<IMacro[]>((resolve, reject) => {
			this.rejectPromise = reject;
			this.resolvePromise = resolve;
		});

		this.unsubscribe = settingsStore.subscribe((newSettings) => {
			this.macros = newSettings.macros;
			this.choices = newSettings.choices;

			this.reload();
		});

		this.open();
		this.display();
	}

	private display(): void {
		this.contentEl.createEl("h2", {
			text: "Macro Manager",
		}).style.textAlign = "center";
		this.addMacroSettings();
		this.addAddMacroBar();
	}

	private addMacroSettings() {
		this.macroContainer = this.contentEl.createDiv();
		this.updateMacroContainer = () => {
			if (this.macros.length <= 1)
				this.macroContainer.className =
					"macroContainer macroContainer1";
			if (this.macros.length === 2)
				this.macroContainer.className =
					"macroContainer macroContainer2";
			if (this.macros.length > 2)
				this.macroContainer.className =
					"macroContainer macroContainer3";
		};

		this.macros.forEach((macro) =>
			this.addMacroSetting(macro, this.macroContainer)
		);

		this.updateMacroContainer();
	}

	private addMacroSetting(macro: IMacro, container: HTMLDivElement) {
		const configureMacroContainer = container.createDiv();

		const macroSetting: Setting = new Setting(configureMacroContainer);
		macroSetting.setName(macro.name);
		macroSetting.infoEl.style.fontWeight = "bold";

		this.addMacroConfigurationItem(
			configureMacroContainer,
			(itemContainerEl) => {
				this.addSpanWithText(itemContainerEl, "Run on plugin load");

				const toggle: ToggleComponent = new ToggleComponent(
					itemContainerEl
				);
				toggle.setValue(macro.runOnStartup);

				toggle.onChange((value) => {
					macro.runOnStartup = value;

					this.updateMacro(macro);
				});
			}
		);

		configureMacroContainer.addClass("configureMacroDiv");
		this.addMacroConfigurationItem(
			configureMacroContainer,
			(itemContainerEl) => {
				const deleteButton: ButtonComponent = new ButtonComponent(
					itemContainerEl
				);
				deleteButton.setClass("mod-warning");
				deleteButton.buttonEl.style.marginRight = "0";

				deleteButton.setButtonText("Delete").onClick((evt) => {
					this.macros = this.macros.filter((m) => m.id !== macro.id);
					const scroll: number = this.macroContainer.scrollTop;

					this.reload();

					this.macroContainer.scrollTop = scroll;
				});

				const configureButton: ButtonComponent = new ButtonComponent(
					itemContainerEl
				);
				configureButton.setClass("mod-cta");
				configureButton.buttonEl.style.marginRight = "0";

				configureButton
					.setButtonText("Configure")
					.onClick(async (evt) => {
						const getReachableChoices = (choices: IChoice[]) => {
							const reachableChoices: IChoice[] = [];
							choices.forEach((choice) => {
								if (choice.type === ChoiceType.Multi)
									reachableChoices.push(
										...getReachableChoices(
											(<IMultiChoice>choice).choices
										)
									);

								if (choice.type !== ChoiceType.Multi)
									reachableChoices.push(choice);
							});
							return reachableChoices;
						};

						const reachableChoices = getReachableChoices(
							this.choices
						);
						const newMacro = await new MacroBuilder(
							this.app,
							this.plugin,
							macro,
							reachableChoices
						).waitForClose;

						if (newMacro) {
							this.updateMacro(newMacro);
							this.reload();
						}
					});
			}
		);
	}

	private addMacroConfigurationItem(
		container: HTMLDivElement,
		callback: (itemContainerEl: HTMLDivElement) => void,
		classString = "configureMacroDivItem"
	) {
		const item: HTMLDivElement = container.createDiv();
		item.addClass(classString);

		callback(item);
	}

	private addSpanWithText(container: HTMLDivElement, text: string) {
		const configureText: HTMLSpanElement = container.createEl("span");
		configureText.setText(text);
	}

	private updateMacro(macro: IMacro) {
		const index = this.macros.findIndex((v) => v.id === macro.id);
		this.macros[index] = macro;

		if (this.updateMacroContainer) this.updateMacroContainer();

		this.reload();
	}

	private reload(): void {
		this.contentEl.empty();
		this.display();
	}

	private addAddMacroBar() {
		const addMacroBarContainer: HTMLDivElement = this.contentEl.createDiv();
		addMacroBarContainer.addClass("addMacroBarContainer");

		const nameInput: TextComponent = new TextComponent(
			addMacroBarContainer
		);
		nameInput.setPlaceholder("Macro name");

		const addMacroButton: ButtonComponent = new ButtonComponent(
			addMacroBarContainer
		);
		addMacroButton
			.setButtonText("Add macro")
			.setClass("mod-cta")
			.onClick(() => {
				const inputValue = nameInput.getValue();

				try {
					settingsStore.createMacro(inputValue);
					this.reload();
					this.macroContainer.scrollTo(
						0,
						this.macroContainer.scrollHeight
					);
				} catch (error) {
					log.logError(error);
				}
			});
	}

	onClose() {
		super.onClose();
		this.unsubscribe();
		this.resolvePromise(this.macros);
	}
}
