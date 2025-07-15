import type IChoice from "../types/choices/IChoice";
import type IMacroChoice from "../types/choices/IMacroChoice";
import type IMultiChoice from "../types/choices/IMultiChoice";
import { TemplateChoice } from "../types/choices/TemplateChoice";
import { CaptureChoice } from "../types/choices/CaptureChoice";
import { MacroChoice } from "../types/choices/MacroChoice";
import { MultiChoice } from "../types/choices/MultiChoice";
import { regenerateIds } from "./macroUtils";
import { getChoiceType, excludeKeys } from "../utilityObsidian";

/**
 * Recursively duplicates a choice, handling all choice types and ensuring unique IDs
 */
export function duplicateChoice(choice: IChoice): IChoice {
	if (!getChoiceType(choice)) throw new Error("Invalid choice type");

	let newChoice: IChoice;

	switch ((choice as IChoice).type) {
		case "Template":
			newChoice = new TemplateChoice(`${choice.name} (copy)`);
			break;
		case "Capture":
			newChoice = new CaptureChoice(`${choice.name} (copy)`);
			break;
		case "Macro":
			newChoice = new MacroChoice(`${choice.name} (copy)`);
			break;
		case "Multi":
			newChoice = new MultiChoice(`${choice.name} (copy)`);
			break;
	}

	if (choice.type !== "Multi") {
		Object.assign(newChoice, excludeKeys(choice, ["id", "name"]));
		
		// Deep clone macro for MacroChoice to avoid shared references
		if (choice.type === "Macro") {
			(newChoice as IMacroChoice).macro = structuredClone((choice as IMacroChoice).macro);
			// Regenerate all IDs to prevent collisions
			regenerateIds((newChoice as IMacroChoice).macro);
		}
	} else {
		(newChoice as IMultiChoice).choices = (
			choice as IMultiChoice
		).choices.map((c) => duplicateChoice(c));
	}

	return newChoice;
}
