import type { IMacro } from "../../types/macros/IMacro";
import type { App } from "obsidian";
import { Modal, Setting } from "obsidian";
import GenericInputPrompt from "../GenericInputPrompt/GenericInputPrompt";
import type IChoice from "../../types/choices/IChoice";
import type IMacroChoice from "../../types/choices/IMacroChoice";
import type QuickAdd from "../../main";
import {
	CommandSequenceEditor,
	type CommandSequenceEditorConditionalHandlers,
} from "./CommandSequenceEditor";
import type { IConditionalCommand } from "../../types/macros/Conditional/IConditionalCommand";
import { ConditionalCommandSettingsModal } from "./ConditionalCommandSettingsModal";
import { ConditionalBranchEditorModal } from "./ConditionalBranchEditorModal";
import { addChoiceIconSetting } from "../ChoiceBuilder/components/choiceIconSetting";
import { addAutosaveFooter } from "../ChoiceBuilder/components/autosaveFooter";
import {
	childChoicesOf,
	isChoiceLike,
	rootChoicesOf,
} from "../../utils/choiceUtils";
import {
	isMacroObject,
	macroCommandsValueOf,
} from "../../utils/macroUtils";
import type { ICommand } from "../../types/macros/ICommand";
import { v4 as uuidv4 } from "uuid";
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

export class MacroBuilder extends Modal {
	public choice: IMacroChoice;
	public macro: IMacro;
	public waitForClose: Promise<IMacroChoice>;
	private readonly choices: IChoice[] = [];
	private commandEditor: CommandSequenceEditor | null = null;
	private resolvePromise: (choice: IMacroChoice) => void;
	private plugin: QuickAdd;

	constructor(app: App, plugin: QuickAdd, choice: IMacroChoice, choices: IChoice[]) {
		super(app);
		this.choice = choice;
		this.macro = choice.macro;
		this.choices = getChoicesAsList(choices);
		this.plugin = plugin;

		this.waitForClose = new Promise<IMacroChoice>(
			(resolve) => {
				this.resolvePromise = resolve;
			}
		);

		this.display();
		// Installed here, not in display(): reload() re-runs display(), which
		// empties contentEl. The footer lives on modalEl and survives that.
		addAutosaveFooter(this, "macro");
		this.open();
	}

	onClose() {
		super.onClose();
		this.resolvePromise(this.choice);
		this.commandEditor?.destroy();
		this.commandEditor = null;
	}

	protected display() {
		this.containerEl.addClass("quickAddModal", "macroBuilder");
		this.contentEl.empty();
		this.addCenteredHeader(this.choice.name);
		this.addCommandEditor();
		this.addDateOriginSetting();
		this.addRunOnStartupSetting();
		this.addCommandPaletteSettings();
		this.addIconSetting();
	}

	protected addCenteredHeader(header: string): void {
		const headerEl = this.contentEl.createEl("h2");
		headerEl.addClass("qa-clickable-modal-title");

		// Rename affordance is a real <button> (keyboard operable: Enter/Space) inside
		// the heading, so the <h2> keeps its heading role for screen readers (#1250).
		const renameButton = headerEl.createEl("button", {
			cls: "qa-rename-title-button",
			text: header,
			attr: { type: "button", "aria-label": `Rename ${header}` },
		});

		renameButton.addEventListener("click", () => {
			void (async () => {
				try {
					const newName: string = await GenericInputPrompt.Prompt(
						this.app,
						`Update name for ${this.choice.name}`,
						this.choice.name,
						this.choice.name
					);
					if (!newName) return;

					// Keep choice name and macro name in sync. The macro object can
					// be missing from a hand-edited data.json; renaming the choice
					// still has to work, so only sync a macro that is there.
					this.choice.name = newName;
					if (isMacroObject(this.macro)) this.macro.name = newName;
					this.reload();
				} catch {
					// Prompt cancelled (Esc/Cancel) — keep the current name.
				}
			})();
		});
	}

	private addDateOriginSetting(): void {
		const current = this.choice.dateOrigin;
		const preset = dateOriginToPreset(current);

		new Setting(this.contentEl)
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
			new Setting(this.contentEl)
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
			new Setting(this.contentEl)
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
			new Setting(this.contentEl)
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

	private addCommandPaletteSettings(): void {
		new Setting(this.contentEl)
			.setName(COMMAND_SETTING_NAME)
			.setDesc(COMMAND_SETTING_DESC)
			.addToggle((toggle) => {
				toggle.setValue(this.choice.command).onChange((value) => {
					this.choice.command = value;
					this.reload();
				});
			});

		if (
			this.choice.command &&
			canOfferPickDayCommand(this.choice.dateOrigin)
		) {
			new Setting(this.contentEl)
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

	private addRunOnStartupSetting(): void {
		new Setting(this.contentEl)
			.setName("Run on startup")
			.setDesc("Execute this macro when Obsidian starts")
			.addToggle(toggle => toggle
				.setValue(this.choice.runOnStartup)
				.onChange(value => {
					this.choice.runOnStartup = value;
				})
			);
	}

	private addIconSetting(): void {
		addChoiceIconSetting(this.app, this.contentEl, this.choice, (icon) => {
			this.choice.icon = icon;
		});
	}

	private reload() {
		this.commandEditor?.destroy();
		this.commandEditor = null;
		this.display();
	}

	/**
	 * The value to show as this macro's command list.
	 *
	 * `choice.macro` is untrusted too, and a Macro choice whose `macro` key is
	 * missing entirely used to make "Configure" do nothing at all: `display()`
	 * runs from the constructor, before `open()`, so the throw took the modal with
	 * it.
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

	private addCommandEditor() {
		const editorContainer = this.contentEl.createDiv("macroBuilder__editor");
		this.commandEditor = new CommandSequenceEditor({
			app: this.app,
			plugin: this.plugin,
			commands: this.macroCommandsValue(),
			choices: this.choices,
			onCommandsChange: (commands) => {
				this.setMacroCommands(commands);
			},
			conditionalHandlers: this.buildConditionalHandlers(),
		});

		this.commandEditor.render(editorContainer);
	}

	private buildConditionalHandlers(): CommandSequenceEditorConditionalHandlers {
		return {
			configureCondition: (command) =>
				this.configureConditionalCondition(command),
			editThenBranch: (command) =>
				this.configureConditionalBranch(command, "then"),
			editElseBranch: (command) =>
				this.configureConditionalBranch(command, "else"),
		};
	}

	private async configureConditionalCondition(
		command: IConditionalCommand
	): Promise<boolean> {
		const modal = new ConditionalCommandSettingsModal(this.app, command);
		const result = await modal.waitForClose;
		return result !== null;
	}

	private async configureConditionalBranch(
		command: IConditionalCommand,
		branch: "then" | "else"
	): Promise<boolean> {
		const title = branch === "then" ? "Then branch" : "Else branch";
		const modal = new ConditionalBranchEditorModal({
			app: this.app,
			plugin: this.plugin,
			choices: this.choices,
			title: `Edit ${title} commands`,
			commands: branch === "then" ? command.thenCommands : command.elseCommands,
			conditionalHandlers: this.buildConditionalHandlers(),
		});

		const updatedCommands = await modal.waitForClose;
		if (!updatedCommands) return false;

		if (branch === "then") {
			command.thenCommands = updatedCommands;
		} else {
			command.elseCommands = updatedCommands;
		}

		return true;
	}
}
