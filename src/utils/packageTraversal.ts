import type IChoice from "../types/choices/IChoice";
import { isCaptureChoice, isMacroChoice, isMultiChoice, isTemplateChoice } from "../types/choices/choiceType";
import type ICaptureChoice from "../types/choices/ICaptureChoice";
import type { ICommand } from "../types/macros/ICommand";
import type { IChoiceCommand } from "../types/macros/IChoiceCommand";
import type { IUserScript } from "../types/macros/IUserScript";
import type { IConditionalCommand } from "../types/macros/Conditional/IConditionalCommand";
import type { INestedChoiceCommand } from "../types/macros/QuickCommands/INestedChoiceCommand";
import { childChoicesOf, isChoiceLike, rootChoicesOf } from "./choiceUtils";
import { commandListOf, isCommandLike } from "./macroUtils";
import { collectTemplateIncludePaths } from "./templateIncludes";
import { CommandType } from "../types/macros/CommandType";

interface ChoiceCatalogEntry {
	choice: IChoice;
	parentId: string | null;
	path: string[];
}

interface ChoiceClosureResult {
	catalog: Map<string, ChoiceCatalogEntry>;
	choiceIds: string[];
	missingChoiceIds: string[];
}

interface ScriptDependencyCollection {
	userScriptPaths: Set<string>;
	conditionalScriptPaths: Set<string>;
}

interface FileDependencyCollection {
	templatePaths: Set<string>;
	captureTemplatePaths: Set<string>;
	/**
	 * Files pulled in by `{{TEMPLATE:...}}` in an enabled Capture format. The
	 * formatter reads them as vault paths at run time, so a package without
	 * them imports fine and then captures a "template not found" placeholder.
	 */
	includePaths: Set<string>;
}

const EMPTY_SET = new Set<string>();

function shouldIncludeChoice(
	choice: IChoice | null | undefined,
	catalog: Map<string, ChoiceCatalogEntry>,
	includedChoiceIds: ReadonlySet<string>,
): boolean {
	if (!choice) return false;
	if (!catalog.has(choice.id)) return true;
	return includedChoiceIds.has(choice.id);
}

function visitReferencedChoiceFromCommand(
	command: ICommand,
	catalog: Map<string, ChoiceCatalogEntry>,
	includedChoiceIds: ReadonlySet<string>,
	visitChoice: (choice: IChoice) => void,
): boolean {
	switch (command.type) {
		case CommandType.Choice: {
			const choiceCommand = command as IChoiceCommand;
			if (!includedChoiceIds.has(choiceCommand.choiceId)) {
				return true;
			}

			const targetEntry = catalog.get(choiceCommand.choiceId);
			if (
				targetEntry &&
				shouldIncludeChoice(
					targetEntry.choice,
					catalog,
					includedChoiceIds,
				)
			) {
				visitChoice(targetEntry.choice);
			}
			return true;
		}
		case CommandType.NestedChoice: {
			const nested = command as INestedChoiceCommand;
			if (
				nested.choice &&
				shouldIncludeChoice(
					nested.choice,
					catalog,
					includedChoiceIds,
				)
			) {
				visitChoice(nested.choice);
			}
			return true;
		}
		default:
			return false;
	}
}

function buildChoiceCatalog(
	allChoices: IChoice[],
): Map<string, ChoiceCatalogEntry> {
	const catalog = new Map<string, ChoiceCatalogEntry>();

	const walk = (
		choices: IChoice[],
		parentId: string | null,
		parentPath: string[],
	) => {
		for (const choice of choices) {
			// A hole in the list (null, a stray primitive) is not a choice; step over
			// it rather than dereferencing it (#1566).
			if (!isChoiceLike(choice)) continue;
			const path = [...parentPath, choice.name];
			catalog.set(choice.id, {
				choice,
				parentId,
				path,
			});

			if (isMultiChoice(choice) && Array.isArray(choice.choices)) {
				walk(choice.choices, choice.id, path);
			}
		}
	};

	walk(rootChoicesOf(allChoices), null, []);

	return catalog;
}

function collectChoiceDependencies(choice: IChoice): Set<string> {
	const dependencies = new Set<string>();

	for (const child of childChoicesOf(choice)) {
		if (!isChoiceLike(child)) continue;
		dependencies.add(child.id);
	}

	if (isMacroChoice(choice)) {
		collectDependenciesFromCommands(choice.macro?.commands, dependencies);
	}

	return dependencies;
}

function collectDependenciesFromCommands(
	// `unknown`: this is `macro.commands` / a conditional's branch out of
	// data.json, and the recursion below feeds itself (see commandListOf).
	commands: unknown,
	accumulator: Set<string>,
): void {
	for (const command of commandListOf(commands)) {
		if (!isCommandLike(command)) continue;

		switch (command.type) {
			case CommandType.Choice: {
				const choiceCommand = command as IChoiceCommand;
				if (choiceCommand.choiceId) accumulator.add(choiceCommand.choiceId);
				break;
			}
			case CommandType.Conditional: {
				const conditional = command as IConditionalCommand;
				collectDependenciesFromCommands(
					conditional.thenCommands,
					accumulator,
				);
				collectDependenciesFromCommands(
					conditional.elseCommands,
					accumulator,
				);
				break;
			}
			case CommandType.NestedChoice: {
				const nested = command as INestedChoiceCommand;
				const nestedChoice = nested.choice;
				if (!nestedChoice) {
					break;
				}

				const nestedDeps = collectChoiceDependencies(nestedChoice);
				for (const depId of nestedDeps) {
					accumulator.add(depId);
				}
				break;
			}
			default:
				break;
		}
	}
}

interface CollectChoiceClosureOptions {
	excludedChoiceIds?: ReadonlySet<string>;
}

export function collectChoiceClosure(
	allChoices: IChoice[],
	rootChoiceIds: readonly string[],
	options?: CollectChoiceClosureOptions,
): ChoiceClosureResult {
	const catalog = buildChoiceCatalog(allChoices);
	const visited = new Set<string>();
	const missing = new Set<string>();
	const excluded = options?.excludedChoiceIds ?? EMPTY_SET;
	const queue: string[] = rootChoiceIds.filter(
		(id) => !excluded.has(id),
	);
	const ordered: string[] = [];

	while (queue.length > 0) {
		const nextId = queue.shift() as string;
		if (visited.has(nextId)) {
			continue;
		}
		if (excluded.has(nextId)) {
			visited.add(nextId);
			continue;
		}

		const entry = catalog.get(nextId);
		if (!entry) {
			missing.add(nextId);
			continue;
		}

		visited.add(nextId);
		ordered.push(nextId);

		const dependencies = collectChoiceDependencies(entry.choice);
		for (const depId of dependencies) {
			if (!catalog.has(depId)) {
				missing.add(depId);
				continue;
			}
			if (excluded.has(depId)) {
				continue;
			}
			queue.push(depId);
		}
	}

	return {
		catalog,
		choiceIds: ordered,
		missingChoiceIds: Array.from(missing),
	};
}

function visitIncludedChoices(
	catalog: Map<string, ChoiceCatalogEntry>,
	choiceIds: Iterable<string>,
	onChoice: (choice: IChoice) => void,
	onCommand: (command: ICommand) => void,
): void {
	const includedChoiceIds = new Set(choiceIds);
	const visited = new Set<string>();
	const visitChoice = (choice: IChoice) => {
		if (!choice || !shouldIncludeChoice(choice, catalog, includedChoiceIds)) return;
		if (visited.has(choice.id)) return;
		visited.add(choice.id);
		onChoice(choice);
		if (isMultiChoice(choice) && Array.isArray(choice.choices)) {
			choice.choices.forEach(visitChoice);
		}
		if (isMacroChoice(choice)) visitCommands(choice.macro?.commands);
	};
	const visitCommands = (commands: unknown) => {
		for (const command of commandListOf(commands)) {
			if (!isCommandLike(command)) continue;
			if (visitReferencedChoiceFromCommand(command, catalog, includedChoiceIds, visitChoice)) continue;
			onCommand(command);
			if (command.type === CommandType.Conditional) {
				const conditional = command as IConditionalCommand;
				visitCommands(conditional.thenCommands);
				visitCommands(conditional.elseCommands);
			}
		}
	};
	for (const id of choiceIds) {
		const entry = catalog.get(id);
		if (entry) visitChoice(entry.choice);
	}
}

export function collectScriptDependencies(
	catalog: Map<string, ChoiceCatalogEntry>,
	choiceIds: Iterable<string>,
): ScriptDependencyCollection {
	const userScriptPaths = new Set<string>();
	const conditionalScriptPaths = new Set<string>();
	visitIncludedChoices(catalog, choiceIds, () => { }, (command) => {
		if (command.type === CommandType.UserScript) {
			const script = command as IUserScript;
			if (script.path) userScriptPaths.add(script.path);
		} else if (command.type === CommandType.Conditional) {
			const { condition } = command as IConditionalCommand;
			if (condition.mode === "script" && condition.scriptPath) {
				conditionalScriptPaths.add(condition.scriptPath);
			}
		}
	});
	return { userScriptPaths, conditionalScriptPaths };
}

export function collectFileDependencies(
	catalog: Map<string, ChoiceCatalogEntry>,
	choiceIds: Iterable<string>,
): FileDependencyCollection {
	const templatePaths = new Set<string>();
	const captureTemplatePaths = new Set<string>();
	const includePaths = new Set<string>();
	visitIncludedChoices(catalog, choiceIds, (choice) => {
		if (isTemplateChoice(choice) && choice.templatePath) {
			templatePaths.add(choice.templatePath);
		}
		if (isCaptureChoice(choice)) {
			const creation = choice.createFileIfItDoesntExist;
			if (creation?.enabled && creation.createWithTemplate && creation.template) {
				captureTemplatePaths.add(creation.template);
			}
			for (const path of captureFormatIncludes(choice)) {
				includePaths.add(path);
			}
		}
	}, () => { });
	return { templatePaths, captureTemplatePaths, includePaths };
}

/** `{{TEMPLATE:...}}` paths a Capture's format splices in when it runs. */
export function captureFormatIncludes(choice: ICaptureChoice): Set<string> {
	const format = choice.format;
	if (!format?.enabled || typeof format.format !== "string") {
		return new Set<string>();
	}
	return collectTemplateIncludePaths(format.format);
}
