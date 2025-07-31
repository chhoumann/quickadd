import type { App } from "obsidian";
import type { ChoiceType } from "src/types/choices/choiceType";
import { CaptureChoiceBuilder } from "../gui/ChoiceBuilder/captureChoiceBuilder";
import { TemplateChoiceBuilder } from "../gui/ChoiceBuilder/templateChoiceBuilder";
import GenericInputPrompt from "../gui/GenericInputPrompt/GenericInputPrompt";
import GenericYesNoPrompt from "../gui/GenericYesNoPrompt/GenericYesNoPrompt";
import { MacroBuilder } from "../gui/MacroGUIs/MacroBuilder";
import type QuickAdd from "../main";
import { settingsStore } from "../settingsStore";
import { CaptureChoice } from "../types/choices/CaptureChoice";
import type ICaptureChoice from "../types/choices/ICaptureChoice";
import type IChoice from "../types/choices/IChoice";
import type IMacroChoice from "../types/choices/IMacroChoice";
import type IMultiChoice from "../types/choices/IMultiChoice";
import type ITemplateChoice from "../types/choices/ITemplateChoice";
import { MacroChoice } from "../types/choices/MacroChoice";
import { MultiChoice } from "../types/choices/MultiChoice";
import { TemplateChoice } from "../types/choices/TemplateChoice";
import { excludeKeys } from "../utilityObsidian";
import { regenerateIds } from "../utils/macroUtils";

const choiceConstructors: Record<ChoiceType, new (name: string) => IChoice> = {
	Template: TemplateChoice,
	Capture: CaptureChoice,
	Macro: MacroChoice,
	Multi: MultiChoice,
};

export function createChoice(type: ChoiceType, name: string): IChoice {
	const Constructor = choiceConstructors[type];
	if (!Constructor) throw new Error(`Unknown choice type: ${type}`);
	return new Constructor(name);
}

/**
 * Recursively duplicates a choice, ensuring unique ids and deep-cloning macros.
 */
export function duplicateChoice(choice: IChoice): IChoice {
	const newChoice = createChoice(choice.type, `${choice.name} (copy)`);

	if (choice.type === "Multi") {
		(newChoice as IMultiChoice).choices = (choice as IMultiChoice).choices.map(
			duplicateChoice,
		);
		return newChoice;
	}

	// copy simple props except id/name
	Object.assign(newChoice, excludeKeys(choice, ["id", "name"]));

	if (choice.type === "Macro") {
		(newChoice as IMacroChoice).macro = structuredClone(
			(choice as IMacroChoice).macro,
		);
		regenerateIds((newChoice as IMacroChoice).macro);
	}

	return newChoice;
}

/**
 * Get the appropriate builder for a choice
 */
export function getChoiceBuilder(
	choice: IChoice,
	app: App,
	plugin: QuickAdd,
): TemplateChoiceBuilder | CaptureChoiceBuilder | MacroBuilder | undefined {
	type Builder =
		| TemplateChoiceBuilder
		| CaptureChoiceBuilder
		| MacroBuilder
		| undefined;

	const builderFactory: Record<ChoiceType, () => Builder> = {
		Template: () =>
			new TemplateChoiceBuilder(app, choice as ITemplateChoice, plugin),
		Capture: () =>
			new CaptureChoiceBuilder(app, choice as ICaptureChoice, plugin),
		Macro: () =>
			new MacroBuilder(
				app,
				plugin,
				choice as IMacroChoice,
				settingsStore.getState().choices,
			),
		Multi: () => undefined,
	};

	const creator = builderFactory[choice.type];
	return typeof creator === "function" ? creator() : undefined;
}

/**
 * Handle choice deletion with confirmation
 */
export async function deleteChoiceWithConfirmation(
	choice: IChoice,
	app: App,
): Promise<boolean> {
	const isMulti = choice.type === "Multi";
	const isMacro = choice.type === "Macro";

	const userConfirmed: boolean = await GenericYesNoPrompt.Prompt(
		app,
		`Confirm deletion of choice`,
		`Please confirm that you wish to delete '${choice.name}'.
            ${isMulti
			? "Deleting this choice will delete all (" +
			(choice as IMultiChoice).choices.length +
			") choices inside it!"
			: ""
		}
            ${isMacro
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
	plugin: QuickAdd,
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
	constructor(private plugin: QuickAdd) { }

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
