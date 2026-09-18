import { v4 as uuidv4 } from "uuid";
import type ICaptureChoice from "../types/choices/ICaptureChoice";
import type IChoice from "../types/choices/IChoice";
import type IMacroChoice from "../types/choices/IMacroChoice";
import type IMultiChoice from "../types/choices/IMultiChoice";
import type ITemplateChoice from "../types/choices/ITemplateChoice";
import { CommandType } from "../types/macros/CommandType";
import type { IConditionalCommand } from "../types/macros/Conditional/IConditionalCommand";
import type { IChoiceCommand } from "../types/macros/IChoiceCommand";
import type { IUserScript } from "../types/macros/IUserScript";
import type { INestedChoiceCommand } from "../types/macros/QuickCommands/INestedChoiceCommand";
import {
	childChoicesOf,
	hasUnreadableChildren,
	isChoiceLike
} from "../utils/choiceUtils";
import {
	commandListOf,
	isCommandLike,
	isMacroObject,
	macroCommandsValueOf,
} from "../utils/macroUtils";
import type { UserScriptSecretSanitizerOptions } from "../utils/userScriptSecrets";
import {
	stripUserScriptSecretRefsFromCommand
} from "../utils/userScriptSecrets";

export function remapChoiceTree(
	choice: IChoice,
	idMap: Map<string, string>,
	importableChoiceIds: Set<string>,
	secretSanitizerOptions: UserScriptSecretSanitizerOptions,
): IChoice {
	const originalId = choice.id;
	const finalId = idMap.get(originalId) ?? originalId;
	choice.id = finalId;
	const isDuplicated = finalId !== originalId;

	if (choice.type === "Macro") {
		const macroChoice = choice as IMacroChoice;
		// Only object macros can retain a regenerated id when serialized; array macros are command lists.
		if (isDuplicated && isMacroObject(macroChoice.macro)) {
			macroChoice.macro.id = uuidv4();
		}
		// Read array-valued macros as command lists, including their choice and secret references.
		remapCommands(
			macroCommandsValueOf(macroChoice.macro),
			idMap,
			importableChoiceIds,
			isDuplicated,
			secretSanitizerOptions,
		);
	}

	if (choice.type === "Multi") {
		const multi = choice as IMultiChoice;
		if (Array.isArray(multi.choices)) {
			multi.choices = multi.choices
				// Ignore malformed child entries while retaining importable siblings.
				.filter((child) => isChoiceLike(child) && importableChoiceIds.has(child.id))
				.map((child) =>
					remapChoiceTree(
						child,
						idMap,
						importableChoiceIds,
						secretSanitizerOptions,
					),
				);
		}
	}

	return choice;
}

function remapCommands(
	// `unknown`: raw `macro.commands` / branch values out of an imported package.
	commands: unknown,
	idMap: Map<string, string>,
	importableChoiceIds: Set<string>,
	shouldRegenerateIds: boolean,
	secretSanitizerOptions: UserScriptSecretSanitizerOptions,
): void {
	// Mutates each command in place, so a value we cannot read is simply left
	// alone rather than replaced with the [] we read it as.
	for (const command of commandListOf(commands)) {
		if (!isCommandLike(command)) continue;
		stripUserScriptSecretRefsFromCommand(command, secretSanitizerOptions);

		if (shouldRegenerateIds) {
			command.id = uuidv4();
		}

		switch (command.type) {
			case CommandType.Choice: {
				const choiceCommand = command as IChoiceCommand;
				const mapped = idMap.get(choiceCommand.choiceId);
				if (mapped) choiceCommand.choiceId = mapped;
				break;
			}
			case CommandType.Conditional: {
				const conditional = command as IConditionalCommand;
				remapCommands(
					conditional.thenCommands,
					idMap,
					importableChoiceIds,
					shouldRegenerateIds,
					secretSanitizerOptions,
				);
				remapCommands(
					conditional.elseCommands,
					idMap,
					importableChoiceIds,
					shouldRegenerateIds,
					secretSanitizerOptions,
				);
				break;
			}
			case CommandType.NestedChoice: {
				const nested = command as INestedChoiceCommand;
				if (nested.choice && importableChoiceIds.has(nested.choice.id)) {
					nested.choice = remapChoiceTree(
						nested.choice,
						idMap,
						importableChoiceIds,
						secretSanitizerOptions,
					);
				}
				break;
			}
			default:
				break;
		}
	}
}

export function replaceChoiceInTree(choices: IChoice[], replacement: IChoice): boolean {
	for (let i = 0; i < choices.length; i++) {
		const current = choices[i];
		if (!isChoiceLike(current)) continue;
		if (current.id === replacement.id) {
			choices.splice(i, 1, replacement);
			return true;
		}
		if (replaceChoiceInTree(childChoicesOf(current), replacement)) {
			return true;
		}
	}
	return false;
}

export function insertUnderParent(
	choices: IChoice[],
	parentId: string,
	child: IChoice,
): boolean {
	for (const choice of choices) {
		if (!isChoiceLike(choice)) continue;
		if (choice.id === parentId && choice.type === "Multi") {
			return insertIntoMulti(choice as IMultiChoice, child);
		}
		if (insertUnderParent(childChoicesOf(choice), parentId, child)) {
			return true;
		}
	}
	return false;
}

/**
 * Returns false when the parent's existing children could not be read: importing
 * INTO such a folder would replace whatever data.json still holds under it with
 * a one-element array. Callers fall back to a root append, so the imported
 * choice still lands somewhere rather than costing the user that value (#1566).
 */
export function insertIntoMulti(parent: IMultiChoice, child: IChoice): boolean {
	if (!Array.isArray(parent.choices)) {
		if (hasUnreadableChildren(parent)) return false;
		parent.choices = [];
	}
	const idx = parent.choices.findIndex(
		(choice) => isChoiceLike(choice) && choice.id === child.id,
	);
	if (idx !== -1) {
		parent.choices.splice(idx, 1, child);
	} else {
		parent.choices.push(child);
	}
	return true;
}

export function findMultiByPath(
	rootChoices: IChoice[],
	path: string[],
): IMultiChoice | null {
	if (path.length === 0) return null;
	let currentChoices = rootChoices;
	let currentMulti: IMultiChoice | null = null;

	for (const segment of path) {
		const next = currentChoices.find(
			(choice) =>
				isChoiceLike(choice) &&
				choice.type === "Multi" &&
				choice.name === segment,
		) as IMultiChoice | undefined;
		if (!next) return null;
		currentMulti = next;
		currentChoices = childChoicesOf(next);
	}

	return currentMulti;
}

export function applyAssetPathOverrides(
	choice: IChoice,
	pathOverrides: Map<string, string>,
): void {
	switch (choice.type) {
		case "Macro": {
			const macroChoice = choice as IMacroChoice;
			applyOverridesToCommands(
				macroCommandsValueOf(macroChoice.macro),
				pathOverrides,
			);
			break;
		}
		case "Template": {
			const templateChoice = choice as ITemplateChoice;
			const replacement = pathOverrides.get(templateChoice.templatePath);
			if (replacement) {
				templateChoice.templatePath = replacement;
			}
			break;
		}
		case "Capture": {
			const captureChoice = choice as ICaptureChoice;
			const templatePath = captureChoice.createFileIfItDoesntExist?.template;
			if (templatePath) {
				const replacement = pathOverrides.get(templatePath);
				if (replacement) {
					captureChoice.createFileIfItDoesntExist = {
						...captureChoice.createFileIfItDoesntExist,
						template: replacement,
					};
				}
			}
			break;
		}
		case "Multi": {
			const multi = choice as IMultiChoice;
			multi.choices?.forEach((child) =>
				applyAssetPathOverrides(child, pathOverrides),
			);
			break;
		}
		default:
			break;
	}
}

function applyOverridesToCommands(
	commands: unknown,
	pathOverrides: Map<string, string>,
): void {
	for (const command of commandListOf(commands)) {
		if (!isCommandLike(command)) continue;

		switch (command.type) {
			case CommandType.UserScript: {
				const userScript = command as IUserScript;
				const replacement = pathOverrides.get(userScript.path);
				if (replacement) {
					// Note-backed scripts use the vault path as their command name
					// (and member selector, `path::member`); keep it in sync when the
					// asset is written to a different destination on import. `.js`
					// scripts use a basename name (!= path), so this leaves them alone.
					if (userScript.name === userScript.path) {
						userScript.name = replacement;
					} else if (userScript.name.startsWith(`${userScript.path}::`)) {
						userScript.name =
							replacement + userScript.name.slice(userScript.path.length);
					}
					userScript.path = replacement;
				}
				break;
			}
			case CommandType.Conditional: {
				const conditional = command as IConditionalCommand;
				if (
					conditional.condition.mode === "script" &&
					conditional.condition.scriptPath
				) {
					const replacement = pathOverrides.get(
						conditional.condition.scriptPath,
					);
					if (replacement) {
						conditional.condition = {
							...conditional.condition,
							scriptPath: replacement,
						};
					}
				}

				applyOverridesToCommands(conditional.thenCommands, pathOverrides);
				applyOverridesToCommands(conditional.elseCommands, pathOverrides);
				break;
			}
			case CommandType.NestedChoice: {
				const nested = command as INestedChoiceCommand;
				if (nested.choice) {
					applyAssetPathOverrides(nested.choice, pathOverrides);
				}
				break;
			}
			default:
				break;
		}
	}
}
