import type { App } from "obsidian";
import type IChoice from "../types/choices/IChoice";
import type IMultiChoice from "../types/choices/IMultiChoice";
import type ITemplateChoice from "../types/choices/ITemplateChoice";
import type ICaptureChoice from "../types/choices/ICaptureChoice";
import type IMacroChoice from "../types/choices/IMacroChoice";
import { TemplateChoice } from "../types/choices/TemplateChoice";
import { CaptureChoice } from "../types/choices/CaptureChoice";
import { MacroChoice } from "../types/choices/MacroChoice";
import { MultiChoice } from "../types/choices/MultiChoice";
import { TemplateChoiceBuilder } from "../gui/ChoiceBuilder/templateChoiceBuilder";
import { CaptureChoiceBuilder } from "../gui/ChoiceBuilder/captureChoiceBuilder";
import { MacroBuilder } from "../gui/MacroGUIs/MacroBuilder";
import { settingsStore } from "../settingsStore";
import GenericYesNoPrompt from "../gui/GenericYesNoPrompt/GenericYesNoPrompt";
import GenericInputPrompt from "../gui/GenericInputPrompt/GenericInputPrompt";
import type QuickAdd from "../main";

export type ChoiceType = "Template" | "Capture" | "Macro" | "Multi";

/**
 * Factory for creating new choices
 */
export function createChoice(type: ChoiceType, name: string): IChoice {
	switch (type) {
		case "Template":
			return new TemplateChoice(name);
		case "Capture":
			return new CaptureChoice(name);
		case "Macro":
			return new MacroChoice(name);
		case "Multi":
			return new MultiChoice(name);
		default:
			throw new Error(`Unknown choice type: ${type}`);
	}
}

/**
 * Get the appropriate builder for a choice
 */
export function getChoiceBuilder(
	choice: IChoice,
	app: App,
	plugin: QuickAdd
): TemplateChoiceBuilder | CaptureChoiceBuilder | MacroBuilder | undefined {
	switch (choice.type) {
		case "Template":
			return new TemplateChoiceBuilder(
				app,
				choice as ITemplateChoice,
				plugin,
			);
		case "Capture":
			return new CaptureChoiceBuilder(
				app,
				choice as ICaptureChoice,
				plugin,
			);
		case "Macro":
			return new MacroBuilder(
				app,
				plugin,
				choice as IMacroChoice,
				settingsStore.getState().choices,
			);
		case "Multi":
		default:
			return undefined;
	}
}

/**
 * Handle choice deletion with confirmation
 */
export async function deleteChoiceWithConfirmation(
	choice: IChoice,
	app: App
): Promise<boolean> {
	const isMulti = choice.type === "Multi";
	const isMacro = choice.type === "Macro";

	const userConfirmed: boolean = await GenericYesNoPrompt.Prompt(
		app,
		`Confirm deletion of choice`,
		`Please confirm that you wish to delete '${choice.name}'.
            ${
				isMulti
					? "Deleting this choice will delete all (" +
						(choice as IMultiChoice).choices.length +
						") choices inside it!"
					: ""
			}
            ${
				isMacro
					? "Deleting this choice will delete its macro commands!"
					: ""
			}
            `,
	);

	return userConfirmed;
}

/**
 * Configure a choice through its builder
 */
export async function configureChoice(
	choice: IChoice,
	app: App,
	plugin: QuickAdd
): Promise<IChoice | undefined> {
	if (choice.type === "Multi") {
		const name = await GenericInputPrompt.Prompt(
			app,
			`Rename ${choice.name}`,
			"",
			choice.name,
		);
		if (!name) return undefined;

		return { ...choice, name };
	}

	const builder = getChoiceBuilder(choice, app, plugin);
	if (!builder) {
		throw new Error("Invalid choice type");
	}

	return await builder.waitForClose;
}

/**
 * Toggle command registration for a choice
 */
export function createToggleCommandChoice(choice: IChoice): IChoice {
	return { ...choice, command: !choice.command };
}

/**
 * Command registry adapter to decouple plugin interactions
 */
export class CommandRegistry {
	constructor(private plugin: QuickAdd) {}

	enableCommand(choice: IChoice): void {
		this.plugin.addCommandForChoice(choice);
	}

	disableCommand(choice: IChoice): void {
		this.plugin.removeCommandForChoice(choice);
	}

	updateCommand(oldChoice: IChoice, newChoice: IChoice): void {
		this.plugin.removeCommandForChoice(oldChoice);
		this.plugin.addCommandForChoice(newChoice);
	}
}
