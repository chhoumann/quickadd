import type { App } from "obsidian";
import type QuickAdd from "../../main";
import type IChoice from "../../types/choices/IChoice";
import type ICaptureChoice from "../../types/choices/ICaptureChoice";
import type ITemplateChoice from "../../types/choices/ITemplateChoice";
import type { INestedChoiceCommand } from "../../types/macros/QuickCommands/INestedChoiceCommand";
import { CaptureChoiceBuilder } from "../ChoiceBuilder/captureChoiceBuilder";
import { TemplateChoiceBuilder } from "../ChoiceBuilder/templateChoiceBuilder";

/**
 * A Create or Add step's choice, as its compact builder over the sequence.
 * `onSave` gets the step with the edited choice when the page is left,
 * synchronously, so it is in before the sequence page saves (BuilderPage).
 */
export function openNestedChoiceBuilder(
	app: App,
	plugin: QuickAdd,
	command: INestedChoiceCommand,
	onSave: (command: INestedChoiceCommand) => void,
): void {
	const save = (choice: IChoice) => onSave({ ...command, choice, name: choice.name });
	const choice = command.choice;
	if (choice.type === "Template") {
		new TemplateChoiceBuilder(app, choice as ITemplateChoice, plugin, save).open();
	} else if (choice.type === "Capture") {
		new CaptureChoiceBuilder(app, choice as ICaptureChoice, plugin, save).open();
	}
}
