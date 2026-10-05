import type { IMacro } from "../../types/macros/IMacro";
import type { App } from "obsidian";
import { Setting, SettingGroup } from "obsidian";
import type IChoice from "../../types/choices/IChoice";
import type IMacroChoice from "../../types/choices/IMacroChoice";
import type QuickAdd from "../../main";
import {
	CommandSequenceEditor,
	type CommandSequenceEditorConditionalHandlers,
} from "./CommandSequenceEditor";
import type { IConditionalCommand } from "../../types/macros/Conditional/IConditionalCommand";
import { ConditionalCommandSettingsModal } from "./ConditionalCommandSettingsModal";
import { ConditionalBranchEditorPage } from "./ConditionalBranchEditorPage";
import { getConditionSummary } from "../../utils/conditionalHelpers";
import { addChoiceIconSetting } from "../ChoiceBuilder/components/choiceIconSetting";
import { type LedeHandle, mountLede } from "../ChoiceBuilder/components/mountLede.svelte";
import { settingsStore } from "../../settingsStore";
import { summarizeChoice } from "../../v3/choiceSummary";
import { BuilderPage, nameOrFallback } from "../ChoiceBuilder/builderPage";
import { RIBBON_SETTING_NAME, actionInRibbon, setActionInRibbon } from "../ChoiceBuilder/actionRibbon";
import {
	childChoicesOf,
	isChoiceLike,
	resolveChoiceIcon,
	rootChoicesOf,
} from "../../utils/choiceUtils";
import {
	isMacroObject,
	macroCommandsValueOf,
} from "../../utils/macroUtils";
import type { ICommand } from "../../types/macros/ICommand";
import { uuidv4 } from "../../utils/uuid";
import { DATE_ORIGIN_UNITS, isDateOriginUnit } from "../../types/dateOrigin";
import {
	COMMAND_SETTING_DESC,
	COMMAND_SETTING_NAME,
	PICK_DAY_SETTING_DESC,
	canOfferPickDayCommand,
	pickDaySettingName,
} from "../../types/choiceCommands";
import {
	ASK_DEFAULT_SETTING_DESC,
	ASK_DEFAULT_SETTING_NAME,
	CUSTOM_OFFSET_SETTING_DESC,
	CUSTOM_OFFSET_SETTING_NAME,
	DATE_ORIGIN_PRESET_OPTIONS,
	DATE_ORIGIN_SETTING_DESC,
	DATE_ORIGIN_SETTING_NAME,
	VARIABLE_SETTING_DESC,
	VARIABLE_SETTING_NAME,
	askDefaultFromPresetId,
	askDefaultOptions,
	askDefaultToPresetId,
	dateOriginFromPreset,
	dateOriginToPreset,
	isDateOriginPreset,
} from "../../types/dateOriginPresets";

/** Exported for the malformed-tree sweep (src/utils/malformedChoices.entrypoints.test.ts). */
export function getChoicesAsList(nestedChoices: IChoice[]): IChoice[] {
	const arr: IChoice[] = [];

	const recursive = (choices: IChoice[]) => {
		choices.forEach((choice) => {
			if (!isChoiceLike(choice)) return;
			if (choice.type === "Multi") {
				recursive(childChoicesOf(choice));
			} else {
				arr.push(choice);
			}
		});
	};

	recursive(rootChoicesOf(nestedChoices));

	return arr;
}

export class MacroBuilder extends BuilderPage<IMacroChoice> {
	public choice: IMacroChoice;
	public macro: IMacro;
	private readonly choices: IChoice[] = [];
	private commandEditor: CommandSequenceEditor | null = null;
	private lede: LedeHandle | null = null;
	private plugin: QuickAdd;
	private readonly openedName: string;
	private pickDaySetting: Setting | null = null;

	constructor(
		app: App,
		plugin: QuickAdd,
		choice: IMacroChoice,
		choices: IChoice[],
		onSave: (choice: IMacroChoice) => void,
	) {
		super(app, choice.name, onSave);
		this.choice = choice;
		this.macro = choice.macro;
		this.openedName = choice.name;
		this.choices = getChoicesAsList(choices).filter((c) => c.id !== choice.id);
		this.plugin = plugin;
		this.containerEl.addClass("macroBuilder");
	}

	protected result(): IMacroChoice {
		const name = nameOrFallback(this.choice.name, this.openedName);
		this.choice.name = name;
		if (isMacroObject(this.macro)) this.macro.name = name;
		return this.choice;
	}

	protected destroy(): void {
		this.commandEditor?.destroy();
		this.commandEditor = null;
		this.lede?.destroy();
		this.lede = null;
	}

	protected render(containerEl: HTMLElement) {
		this.addNameSetting(containerEl, this.choice.name, this.openedName, (name) => {
			// Keep choice name and macro name in sync. The macro object can be
			// missing from a hand-edited data.json; renaming the choice still has
			// to work, so only sync a macro that is there.
			this.choice.name = name;
			if (isMacroObject(this.macro)) this.macro.name = name;
			this.pickDaySetting?.setName(pickDaySettingName(name.trim() || this.openedName));
		});
		this.lede = mountLede(containerEl.createDiv(), ...this.ledeContent());
		this.addCommandEditor(this.addGroup(containerEl, "Steps"));
		const behavior = this.addGroup(containerEl, "Behavior");
		this.addOnePageInputSetting(behavior);
		this.addDateOriginSetting(behavior);
		this.addRunOnStartupSetting(behavior);
		this.addCommandPaletteSettings(behavior);
		this.addRibbonSetting(behavior);
		this.addIconSetting(behavior);
	}

	/** The macro's icon, and what its steps do. */
	private ledeContent(): [string, string] {
		return [resolveChoiceIcon(this.choice), summarizeChoice(this.choice, settingsStore.getState().choices)];
	}

	private updateLede(): void {
		this.lede?.set(...this.ledeContent());
	}

	/** An Obsidian setting group; returns the element its settings go in. */
	private addGroup(containerEl: HTMLElement, heading: string): HTMLElement {
		return new SettingGroup(containerEl).setHeading(heading).listEl;
	}

	private addOnePageInputSetting(parent: HTMLElement): void {
		new Setting(parent)
			.setName("One-page input override")
			.addDropdown((dropdown) => {
				dropdown
					.addOption("", "Follow global setting")
					.addOption("always", "Always")
					.addOption("never", "Never")
					.setValue(this.choice.onePageInput ?? "")
					.onChange((value) => {
						this.choice.onePageInput =
							value === "always" || value === "never" ? value : undefined;
					});
			});
	}

	private addDateOriginSetting(parent: HTMLElement): void {
		const current = this.choice.dateOrigin;
		const preset = dateOriginToPreset(current);

		new Setting(parent)
			.setName(DATE_ORIGIN_SETTING_NAME)
			.setDesc(DATE_ORIGIN_SETTING_DESC)
			.addDropdown((dropdown) => {
				for (const option of DATE_ORIGIN_PRESET_OPTIONS) {
					dropdown.addOption(option.value, option.label);
				}
				dropdown.setValue(preset);
				dropdown.onChange((value) => {
					if (!isDateOriginPreset(value)) return;
					this.choice.dateOrigin = dateOriginFromPreset({
						preset: value,
						previous: this.choice.dateOrigin,
					});
					this.reload();
				});
			});

		if (preset === "ask") {
			const defaultValue =
				current?.kind === "ask" ? current.defaultValue : undefined;
			new Setting(parent)
				.setName(ASK_DEFAULT_SETTING_NAME)
				.setDesc(ASK_DEFAULT_SETTING_DESC)
				.addDropdown((dropdown) => {
					for (const option of askDefaultOptions(defaultValue)) {
						dropdown.addOption(option.value, option.label);
					}
					dropdown.setValue(askDefaultToPresetId(defaultValue));
					dropdown.onChange((value) => {
						const next = askDefaultFromPresetId(value, defaultValue);
						this.choice.dateOrigin = next
							? { kind: "ask", defaultValue: next }
							: { kind: "ask" };
					});
				});
		}

		if (preset === "custom" && current?.kind === "relative") {
			new Setting(parent)
				.setName(CUSTOM_OFFSET_SETTING_NAME)
				.setDesc(CUSTOM_OFFSET_SETTING_DESC)
				.addText((text) => {
					text.setValue(String(current.offset));
					text.setPlaceholder("-2");
					text.onChange((value) => {
						const origin = this.choice.dateOrigin;
						if (origin?.kind !== "relative") return;
						const trimmed = value.trim();
						if (!/^[+-]?\d+$/.test(trimmed)) return;
						this.choice.dateOrigin = {
							...origin,
							offset: Number(trimmed),
						};
					});
				})
				.addDropdown((dropdown) => {
					for (const unit of DATE_ORIGIN_UNITS) {
						dropdown.addOption(unit, unit);
					}
					dropdown.setValue(current.unit);
					dropdown.onChange((value) => {
						const origin = this.choice.dateOrigin;
						if (origin?.kind !== "relative") return;
						if (!isDateOriginUnit(value)) return;
						this.choice.dateOrigin = { ...origin, unit: value };
					});
				});
		}

		if (preset === "variable") {
			const name = current?.kind === "variable" ? current.name : "";
			new Setting(parent)
				.setName(VARIABLE_SETTING_NAME)
				.setDesc(VARIABLE_SETTING_DESC)
				.addText((text) => {
					text.setValue(name);
					text.setPlaceholder("day");
					text.onChange((value) => {
						this.choice.dateOrigin = { kind: "variable", name: value };
					});
				});
		}
	}

	private addCommandPaletteSettings(parent: HTMLElement): void {
		new Setting(parent)
			.setName(COMMAND_SETTING_NAME)
			.setDesc(COMMAND_SETTING_DESC)
			.addToggle((toggle) => {
				toggle.setValue(this.choice.command).onChange((value) => {
					this.choice.command = value;
					this.reload();
				});
			});

		this.pickDaySetting = null;
		if (
			this.choice.command &&
			canOfferPickDayCommand(this.choice.dateOrigin)
		) {
			this.pickDaySetting = new Setting(parent)
				.setName(pickDaySettingName(this.choice.name))
				.setDesc(PICK_DAY_SETTING_DESC)
				.addToggle((toggle) => {
					toggle
						.setValue(this.choice.pickDayCommand ?? false)
						.onChange((value) => {
							this.choice.pickDayCommand = value;
						});
				});
		}
	}

	/** Saves when flipped: the ribbon is no setting of the choice (see RibbonSetting.svelte). */
	private addRibbonSetting(parent: HTMLElement): void {
		const inRibbon = actionInRibbon(this.choice.id);
		if (inRibbon === null) return;
		new Setting(parent)
			.setName(RIBBON_SETTING_NAME)
			.addToggle((toggle) => {
				toggle.setValue(inRibbon).onChange((value) => {
					setActionInRibbon(this.choice.id, value);
				});
			});
	}

	private addRunOnStartupSetting(parent: HTMLElement): void {
		new Setting(parent)
			.setName("Run on startup")
			.setDesc("Execute this macro when Obsidian starts")
			.addToggle(toggle => toggle
				.setValue(this.choice.runOnStartup)
				.onChange(value => {
					this.choice.runOnStartup = value;
				})
			);
	}

	private addIconSetting(parent: HTMLElement): void {
		addChoiceIconSetting(this.app, parent, this.choice, (icon) => {
			this.choice.icon = icon;
			this.updateLede();
		});
	}

	/** Re-render the page, for settings that add or remove rows. */
	private reload() {
		this.destroy();
		this.containerEl.empty();
		this.render(this.containerEl);
	}

	/**
	 * The value to show as this macro's command list.
	 *
	 * `choice.macro` is untrusted too, and a Macro choice whose `macro` key is
	 * missing entirely used to make "Configure" do nothing at all: the builder
	 * threw while it rendered.
	 *
	 * Three cases, and `macro` being an ARRAY is the one worth naming: `[]` and
	 * `[{...}]` are both objects, but writing `macro.commands` onto an Array sets
	 * a non-index property that `JSON.stringify` drops, so the user's edits would
	 * vanish on every save while the editor happily showed them. Handing the array
	 * itself over as the command list instead means its entries render as the
	 * commands they probably are, and `setMacroCommands` materializes a real macro
	 * object around them on the first edit - nothing lost either way.
	 */
	private macroCommandsValue(): unknown {
		return macroCommandsValueOf(this.macro);
	}

	/**
	 * Commit an edit back onto the choice, materializing the macro object if it
	 * was missing. Only reachable when the editor is usable, which
	 * `macroCommandsValue` guarantees means nothing readable is being replaced.
	 */
	private setMacroCommands(commands: ICommand[]) {
		if (!isMacroObject(this.macro)) {
			this.macro = { id: uuidv4(), name: this.choice.name, commands };
			this.choice.macro = this.macro;
			return;
		}
		this.macro.commands = commands;
	}

	private addCommandEditor(parent: HTMLElement) {
		const editorContainer = parent.createDiv("macroBuilder__editor");
		this.commandEditor = new CommandSequenceEditor({
			app: this.app,
			plugin: this.plugin,
			commands: this.macroCommandsValue(),
			choices: this.choices,
			onCommandsChange: (commands) => {
				this.setMacroCommands(commands);
				this.updateLede();
			},
			conditionalHandlers: this.buildConditionalHandlers(),
		});

		this.commandEditor.render(editorContainer);
	}

	private buildConditionalHandlers(): CommandSequenceEditorConditionalHandlers {
		return {
			configureCondition: (command) =>
				this.configureConditionalCondition(command),
			editThenBranch: (command, onEdited) =>
				this.openBranchPage(command, "then", onEdited),
			editElseBranch: (command, onEdited) =>
				this.openBranchPage(command, "else", onEdited),
		};
	}

	private async configureConditionalCondition(
		command: IConditionalCommand
	): Promise<boolean> {
		const modal = new ConditionalCommandSettingsModal(this.app, command);
		const result = await modal.waitForClose;
		return result !== null;
	}

	/**
	 * A branch's commands, as a page over this one. Its edits land on the
	 * command when the page is left, and `onEdited` saves them into this
	 * macro's list before anything below hears about it.
	 */
	private openBranchPage(
		command: IConditionalCommand,
		branch: "then" | "else",
		onEdited: () => void,
	): void {
		new ConditionalBranchEditorPage({
			app: this.app,
			plugin: this.plugin,
			choices: this.choices,
			title: `${branch === "then" ? "Then" : "Else"}: ${getConditionSummary(command.condition)}`,
			commands: branch === "then" ? command.thenCommands : command.elseCommands,
			conditionalHandlers: this.buildConditionalHandlers(),
			onSave: (commands) => {
				if (!commands) return;
				if (branch === "then") command.thenCommands = commands;
				else command.elseCommands = commands;
				onEdited();
			},
		}).open();
	}
}
