import { uuidv4 } from "../utils/uuid";
import { normalizeVaultPathSeparators } from "../utils/pathUtils";
import { resolveTemplatePath } from "../utils/templateFolderUtils";
import type ICaptureChoice from "../types/choices/ICaptureChoice";
import type IChoice from "../types/choices/IChoice";
import type IMacroChoice from "../types/choices/IMacroChoice";
import type IMultiChoice from "../types/choices/IMultiChoice";
import type ITemplateChoice from "../types/choices/ITemplateChoice";
import { CaptureChoice } from "../types/choices/CaptureChoice";
import { TemplateChoice } from "../types/choices/TemplateChoice";
import { isTemplateChoice, normalizeTemplateChoice } from "../migrations/helpers/normalizeTemplateFileExistsBehavior";
import { coerceLegacyOpenFileInNewTab, createFileOpeningFromLegacy } from "../migrations/helpers/file-opening-legacy";
import { walkChoiceTree } from "../migrations/helpers/choice-traversal";
import { CommandType } from "../types/macros/CommandType";
import type { IConditionalCommand } from "../types/macros/Conditional/IConditionalCommand";
import type { IChoiceCommand } from "../types/macros/IChoiceCommand";
import type { IUserScript } from "../types/macros/IUserScript";
import type { INestedChoiceCommand } from "../types/macros/QuickCommands/INestedChoiceCommand";
import {
	childChoicesOf,
	clearEmptyFormatFlag,
	hasUnreadableChildren,
	isChoiceLike
} from "../utils/choiceUtils";
import {
	commandListOf,
	isCommandLike,
	isMacroObject,
	macroCommandsValueOf,
} from "../utils/macroUtils";
import { rewriteTemplateIncludes } from "../utils/templateIncludes";
import type { UserScriptSecretSanitizerOptions } from "../utils/userScriptSecrets";
import {
	stripUserScriptSecretRefsFromCommand
} from "../utils/userScriptSecrets";

function isPlainObject(value: unknown): value is Record<string, unknown> {
	return !!value && typeof value === "object" && !Array.isArray(value);
}

/**
 * Bring an imported Template or Capture to the shape the rest of QuickAdd
 * expects. Import runs after the one-time migrations, so it applies their
 * per-choice conversions itself (legacy file-exists and file-opening settings),
 * then fills any setting the package leaves out from the defaults a new choice
 * of that type starts with - older exports and hand-written packages omit
 * settings added since. Values the package sets always win.
 */
export function normalizeImportedChoice(choice: IChoice): void {
	if (isTemplateChoice(choice)) normalizeTemplateChoice(choice);
	if (choice.type === "Capture" || choice.type === "Template") {
		// As migrateFileOpeningSettings does for data.json.
		const legacy = choice as IChoice & { fileOpening?: unknown; openFileInNewTab?: unknown; openFileInMode?: unknown };
		const legacyTab = coerceLegacyOpenFileInNewTab(legacy.openFileInNewTab);
		if (!legacy.fileOpening && legacyTab) {
			legacy.fileOpening = createFileOpeningFromLegacy(legacyTab, legacy.openFileInMode);
		}
	}
	// New Captures start with these on (#2007), but a package that leaves them
	// out has always run with them off.
	const insertAfter = (choice as IChoice & { insertAfter?: unknown }).insertAfter;
	if (choice.type === "Capture" && isPlainObject(insertAfter)) {
		insertAfter.insertAtEnd ??= false;
		insertAfter.createIfNotFound ??= false;
	}
	const defaults =
		choice.type === "Capture" ? new CaptureChoice(choice.name) :
		choice.type === "Template" ? new TemplateChoice(choice.name) :
		undefined;
	if (!defaults) return;
	const target = choice as unknown as Record<string, unknown>;
	for (const [key, value] of Object.entries(defaults)) {
		if (value === undefined) continue;
		const current = target[key];
		if (current === undefined) target[key] = value;
		else if (isPlainObject(current) && isPlainObject(value)) target[key] = { ...value, ...current };
	}
	// As loading data.json does: a package exported by 2.29 or earlier can hold
	// a switched-on but empty Capture format or File name.
	clearEmptyFormatFlag(choice);
}

export function remapChoiceTree(
	choice: IChoice,
	idMap: Map<string, string>,
	importableChoiceIds: Set<string>,
	secretSanitizerOptions: UserScriptSecretSanitizerOptions,
): IChoice {
	normalizeImportedChoice(choice);
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
				} else if (isChoiceLike(nested.choice)) {
					// An embedded choice has no flat package entry of its own, so
					// normalize its whole tree here (a Multi's children, a Macro's steps).
					walkChoiceTree(nested.choice, normalizeImportedChoice);
				}
				break;
			}
			default:
				break;
		}
	}
}

export function findChoiceInTree(choices: IChoice[], id: string): IChoice | undefined {
	for (const current of choices) {
		if (!isChoiceLike(current)) continue;
		if (current.id === id) return current;
		const found = findChoiceInTree(childChoicesOf(current), id);
		if (found) return found;
	}
	return undefined;
}

/** Whether `child` sits directly inside the folder `parentId`, wherever that folder is. */
export function isDirectChildOf(
	choices: IChoice[],
	parentId: string,
	childId: string,
): boolean {
	const parent = findChoiceInTree(choices, parentId);
	return (
		parent !== undefined &&
		childChoicesOf(parent).some(
			(choice) => isChoiceLike(choice) && choice.id === childId,
		)
	);
}

/**
 * Overwriting a folder must not cost the reader what they put in it. Each
 * child the package carries replaces its existing counterpart where it sits,
 * so the reader's order survives; children they skipped, added themselves, or
 * that the package no longer carries stay where they are; children new to the
 * package go last. Nested folders merge the same way, including one the reader
 * had dragged out of this folder: the stray-copy pass detaches it before
 * placement, and `detached` hands what it held back to its incoming copy.
 * Entries that are not choices are carried over untouched, never repaired
 * (#1566), and a folder whose children cannot be read at all is left to the
 * wholesale replace. `existing` is undefined when the folder is new to the
 * vault; only detached folders are folded in then.
 */
export function mergeFolderChildren(
	existing: IMultiChoice | undefined,
	incoming: IMultiChoice,
	detached: ReadonlyMap<string, IChoice>,
): void {
	if (!Array.isArray(incoming.choices)) return;
	if (existing && !Array.isArray(existing.choices)) return;
	const pending = new Map<string, IChoice>();
	for (const choice of incoming.choices) {
		if (isChoiceLike(choice)) pending.set(choice.id, choice);
	}
	const merged: IChoice[] = [];
	for (const current of existing?.choices ?? []) {
		const replacement = isChoiceLike(current)
			? pending.get(current.id)
			: undefined;
		if (!replacement) {
			merged.push(current);
			continue;
		}
		if (current.type === "Multi" && replacement.type === "Multi") {
			mergeFolderChildren(
				current as IMultiChoice,
				replacement as IMultiChoice,
				detached,
			);
		}
		merged.push(replacement);
		pending.delete(replacement.id);
	}
	for (const replacement of pending.values()) {
		const source = detached.get(replacement.id);
		if (replacement.type === "Multi") {
			mergeFolderChildren(
				source?.type === "Multi" ? (source as IMultiChoice) : undefined,
				replacement as IMultiChoice,
				detached,
			);
		}
		merged.push(replacement);
	}
	incoming.choices = merged;
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

/** Remove the choice with `id` wherever it sits in the tree; returns it, or undefined when absent. */
export function removeChoiceFromTree(choices: IChoice[], id: string): IChoice | undefined {
	for (let i = 0; i < choices.length; i++) {
		const current = choices[i];
		if (!isChoiceLike(current)) continue;
		if (current.id === id) {
			choices.splice(i, 1);
			return current;
		}
		const removed = removeChoiceFromTree(childChoicesOf(current), id);
		if (removed) return removed;
	}
	return undefined;
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
			const replacement =
				pathOverrides.get(resolveTemplatePath(templateChoice.templatePath)) ??
				pathOverrides.get(templateChoice.templatePath);
			if (replacement) {
				templateChoice.templatePath = replacement;
			}
			break;
		}
		case "Capture": {
			const captureChoice = choice as ICaptureChoice;
			const templatePath = captureChoice.createFileIfItDoesntExist?.template;
			if (templatePath) {
				const replacement =
					pathOverrides.get(resolveTemplatePath(templatePath)) ??
					pathOverrides.get(templatePath);
				if (replacement) {
					captureChoice.createFileIfItDoesntExist = {
						...captureChoice.createFileIfItDoesntExist,
						template: replacement,
					};
				}
			}
			// The format's `{{TEMPLATE:...}}` includes are vault paths too; a
			// bundled include written elsewhere must be followed the same way.
			const format = captureChoice.format;
			if (format && typeof format.format === "string") {
				const rewritten = rewriteTemplateIncludes(format.format, pathOverrides);
				if (rewritten !== format.format) {
					captureChoice.format = { ...format, format: rewritten };
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

/**
 * Where an imported script step should point, or undefined to leave it: its
 * bundled asset's destination, found by the step's own spelling or by its
 * separator-normalized form, else that form itself. A script path is an
 * identity: the loader resolves it with forward slashes only, so
 * `Scripts\\run.js` must not survive import, while leading whitespace names a
 * real vault folder and is never folded into a different asset's path.
 */
function scriptPathReplacement(
	path: string,
	pathOverrides: Map<string, string>,
): string | undefined {
	const identity = normalizeVaultPathSeparators(path);
	const replacement = pathOverrides.get(path) ?? pathOverrides.get(identity) ?? identity;
	return replacement === path ? undefined : replacement;
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
				const replacement = scriptPathReplacement(userScript.path, pathOverrides);
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
					const replacement = scriptPathReplacement(
						conditional.condition.scriptPath,
						pathOverrides,
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
