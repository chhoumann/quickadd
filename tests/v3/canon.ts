import { getWritePosition } from "../../src/engine/captureAction";
import { applyFolderMode, deriveFolderMode } from "../../src/gui/ChoiceBuilder/folderMode";
import { walkChoiceTree } from "../../src/migrations/helpers/choice-traversal";
import { normalizeImportedChoice } from "../../src/services/packageChoiceImport";
import type ICaptureChoice from "../../src/types/choices/ICaptureChoice";
import type IChoice from "../../src/types/choices/IChoice";
import type IMacroChoice from "../../src/types/choices/IMacroChoice";
import type IMultiChoice from "../../src/types/choices/IMultiChoice";
import type ITemplateChoice from "../../src/types/choices/ITemplateChoice";
import { normalizeAppendLinkOptions } from "../../src/types/linkPlacement";
import { buildOpenFileOptions } from "../../src/engine/helpers/openFileOptions";
import type { ICommand } from "../../src/types/macros/ICommand";
import type { IConditionalCommand } from "../../src/types/macros/Conditional/IConditionalCommand";
import type { INestedChoiceCommand } from "../../src/types/macros/QuickCommands/INestedChoiceCommand";
import type { IOpenFileCommand } from "../../src/types/macros/QuickCommands/IOpenFileCommand";
import { normalizeFileOpening } from "../../src/utils/fileOpeningDefaults";
import { macroCommandsValueOf } from "../../src/utils/macroUtils";
import { V2_CHOICE_KEYS, V2_COMMAND_KEYS, identifyNestedChoices } from "../../src/v3/migrate";

/**
 * A v2 choice with only the differences the v3 migration is allowed to make:
 * the drops in the model draft (section 2.6), plus the flag folds and empty
 * lists that turned up while building it. Each rule is numbered after the
 * draft; rules 6 to 9 are additions.
 */
export function canon(choice: IChoice): IChoice {
	const copy = structuredClone(choice);
	// 9. A nested choice saved without an id is named after its step.
	identifyNestedChoices(copy);
	walkChoiceTree(copy, normalizeImportedChoice);
	return canonNode(copy);
}

/** 8. Keys no v2 choice or command of that type holds. */
function withoutUnknownKeys<T extends object>(value: T, known: ReadonlySet<string> | undefined): T {
	if (!known) return value;
	for (const key of Object.keys(value)) if (!known.has(key)) delete (value as Record<string, unknown>)[key];
	return value;
}

function canonNode(choice: IChoice): IChoice {
	withoutUnknownKeys(choice, V2_CHOICE_KEYS[choice.type]);
	switch (choice.type) {
		case "Multi": {
			const multi = choice as IMultiChoice;
			// 5. Date, pick-a-day and one-page settings on a folder.
			delete multi.dateOrigin;
			delete multi.pickDayCommand;
			delete multi.onePageInput;
			// 7. A missing list reads as an empty one.
			multi.choices = (multi.choices ?? []).filter(isObject).map(canonNode);
			return multi;
		}
		case "Macro": {
			const macro = choice as IMacroChoice;
			// 2. macro.id and macro.name. 4. An array-valued macro is its command list.
			macro.macro = { id: macro.id, name: macro.name, commands: canonCommands(macroCommandsValueOf(macro.macro)) };
			return macro;
		}
		case "Template":
		case "Capture":
			return canonWrite(choice as ITemplateChoice | ICaptureChoice);
		default:
			return choice;
	}
}

function canonWrite(choice: ITemplateChoice | ICaptureChoice): IChoice {
	// 1. Link options behind a switched-off link setting. 4. Boolean appendLink.
	const link = normalizeAppendLinkOptions(choice.appendLink);
	choice.appendLink = link.enabled ? link : false;
	// 1. Open settings behind a switched-off open setting.
	choice.fileOpening = normalizeFileOpening(choice.openFile ? choice.fileOpening : undefined);
	// 4. The pre-fileOpening keys import converts but leaves in place.
	delete (choice as unknown as Record<string, unknown>).openFileInNewTab;
	delete (choice as unknown as Record<string, unknown>).openFileInMode;
	if (choice.type === "Template") {
		const template = choice as ITemplateChoice;
		// 6. Folder flags fold to the mode the engine runs.
		template.folder = applyFolderMode(template.folder, deriveFolderMode(template.folder));
		return template;
	}
	const capture = choice as ICaptureChoice;
	const position = getWritePosition(capture);
	const active = capture.captureToActiveFile;
	// 6. Write switches fold to the position the engine runs. 3. An inert
	// active-note position. 1. A new-line direction behind a switched-off toggle.
	capture.prepend = !active && position === "bottom";
	capture.activeFileWritePosition =
		active && position === "activeTop" ? "top" : active && position === "bottom" ? "bottom" : "cursor";
	capture.insertAfter.enabled = position === "after";
	if (capture.insertBefore) capture.insertBefore.enabled = position === "before";
	capture.newLineCapture = {
		enabled: position === "newLineAbove" || position === "newLineBelow",
		direction: position === "newLineAbove" ? "above" : "below",
	};
	capture.templater = { afterCapture: capture.templater?.afterCapture === "wholeFile" ? "wholeFile" : "none" };
	return capture;
}

function canonCommands(value: unknown): ICommand[] {
	return (Array.isArray(value) ? value : []).filter(Boolean).map((command: ICommand) => {
		withoutUnknownKeys(command, V2_COMMAND_KEYS[command.type]);
		switch (command.type) {
			case "NestedChoice": {
				const nested = command as INestedChoiceCommand;
				const inlined =
					(nested.choice.type === "Template" || nested.choice.type === "Capture") &&
					["dateOrigin", "onePageInput", "pickDayCommand", "icon"].every(
						(key) => (nested.choice as unknown as Record<string, unknown>)[key] === undefined,
					) &&
					!nested.choice.command &&
					nested.name === nested.choice.name;
				// 2. The wrapper id of a nested choice that became steps.
				return {
					...nested,
					id: inlined ? `${nested.choice.id}:nested` : nested.id,
					choice: canonNode(nested.choice),
				} as ICommand;
			}
			case "Conditional": {
				const conditional = command as IConditionalCommand;
				return {
					...conditional,
					thenCommands: canonCommands(conditional.thenCommands),
					elseCommands: canonCommands(conditional.elseCommands),
				} as ICommand;
			}
			case "OpenFile": {
				// 4. openInNewTab and direction become the location the engine derives.
				const open = command as IOpenFileCommand;
				const options = buildOpenFileOptions(open);
				delete options.mode;
				return { id: open.id, name: open.name, type: open.type, filePath: open.filePath, ...options } as ICommand;
			}
			default:
				return command;
		}
	});
}

function isObject(value: unknown): boolean {
	return typeof value === "object" && value !== null;
}
