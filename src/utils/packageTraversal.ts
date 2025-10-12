import type IChoice from "../types/choices/IChoice";
import type IMacroChoice from "../types/choices/IMacroChoice";
import type IMultiChoice from "../types/choices/IMultiChoice";
import type ITemplateChoice from "../types/choices/ITemplateChoice";
import type ICaptureChoice from "../types/choices/ICaptureChoice";
import type { ICommand } from "../types/macros/ICommand";
import type { IChoiceCommand } from "../types/macros/IChoiceCommand";
import type { IUserScript } from "../types/macros/IUserScript";
import type { IConditionalCommand } from "../types/macros/Conditional/IConditionalCommand";
import type { INestedChoiceCommand } from "../types/macros/QuickCommands/INestedChoiceCommand";
import { CommandType } from "../types/macros/CommandType";

export interface ChoiceCatalogEntry {
	choice: IChoice;
	parentId: string | null;
	path: string[];
}

export interface ChoiceClosureResult {
	catalog: Map<string, ChoiceCatalogEntry>;
	choiceIds: string[];
	missingChoiceIds: string[];
}

export interface ScriptDependencyCollection {
	userScriptPaths: Set<string>;
	conditionalScriptPaths: Set<string>;
}

export interface FileDependencyCollection {
	templatePaths: Set<string>;
	captureTemplatePaths: Set<string>;
}

function isMultiChoice(choice: IChoice): choice is IMultiChoice {
	return choice.type === "Multi";
}

function isMacroChoice(choice: IChoice): choice is IMacroChoice {
	return choice.type === "Macro";
}

function isTemplateChoice(choice: IChoice): choice is ITemplateChoice {
	return choice.type === "Template";
}

function isCaptureChoice(choice: IChoice): choice is ICaptureChoice {
	return choice.type === "Capture";
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

	walk(allChoices, null, []);

	return catalog;
}

function collectChoiceDependencies(choice: IChoice): Set<string> {
	const dependencies = new Set<string>();

	if (isMultiChoice(choice) && Array.isArray(choice.choices)) {
		for (const child of choice.choices) {
			dependencies.add(child.id);
		}
	}

	if (isMacroChoice(choice)) {
		collectDependenciesFromCommands(choice.macro.commands, dependencies);
	}

	return dependencies;
}

function collectDependenciesFromCommands(
	commands: ICommand[],
	accumulator: Set<string>,
): void {
	for (const command of commands) {
		if (!command) continue;

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
				if (nested.choice) {
					accumulator.add(nested.choice.id);
					const nestedDeps = collectChoiceDependencies(nested.choice);
					for (const depId of nestedDeps) {
						accumulator.add(depId);
					}
				}
				break;
			}
			default:
				break;
		}
	}
}

export function collectChoiceClosure(
	allChoices: IChoice[],
	rootChoiceIds: readonly string[],
): ChoiceClosureResult {
	const catalog = buildChoiceCatalog(allChoices);
	const visited = new Set<string>();
	const missing = new Set<string>();
	const queue: string[] = [...rootChoiceIds];
	const ordered: string[] = [];

	while (queue.length > 0) {
		const nextId = queue.shift() as string;
		if (visited.has(nextId)) {
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
			queue.push(depId);
		}
	}

	return {
		catalog,
		choiceIds: ordered,
		missingChoiceIds: Array.from(missing),
	};
}

export function collectScriptDependencies(
	catalog: Map<string, ChoiceCatalogEntry>,
	choiceIds: Iterable<string>,
): ScriptDependencyCollection {
	const visitedChoices = new Set<string>();
	const userScriptPaths = new Set<string>();
	const conditionalScriptPaths = new Set<string>();

	const visitChoice = (choice: IChoice) => {
		if (!choice) return;
		if (visitedChoices.has(choice.id)) return;

		visitedChoices.add(choice.id);

		if (isMultiChoice(choice) && Array.isArray(choice.choices)) {
			for (const child of choice.choices) {
				visitChoice(child);
			}
		}

		if (isMacroChoice(choice)) {
			visitCommands(choice.macro.commands);
		}
	};

	const visitCommands = (commands: ICommand[]) => {
		for (const command of commands) {
			if (!command) continue;

			switch (command.type) {
				case CommandType.UserScript: {
					const userScript = command as IUserScript;
					if (userScript.path) userScriptPaths.add(userScript.path);
					break;
				}
				case CommandType.Conditional: {
					const conditional = command as IConditionalCommand;
					const condition = conditional.condition;
					if (condition.mode === "script" && condition.scriptPath) {
						conditionalScriptPaths.add(condition.scriptPath);
					}

					visitCommands(conditional.thenCommands);
					visitCommands(conditional.elseCommands);
					break;
				}
				case CommandType.Choice: {
					const choiceCommand = command as IChoiceCommand;
					const targetEntry = catalog.get(choiceCommand.choiceId);
					if (targetEntry) visitChoice(targetEntry.choice);
					break;
				}
				case CommandType.NestedChoice: {
					const nested = command as INestedChoiceCommand;
					if (nested.choice) visitChoice(nested.choice);
					break;
				}
				default:
					break;
			}
		}
	};

	for (const id of choiceIds) {
		const entry = catalog.get(id);
		if (entry) {
			visitChoice(entry.choice);
		}
	}

	return { userScriptPaths, conditionalScriptPaths };
}

export function collectFileDependencies(
	catalog: Map<string, ChoiceCatalogEntry>,
	choiceIds: Iterable<string>,
): FileDependencyCollection {
	const visitedChoices = new Set<string>();
	const templatePaths = new Set<string>();
	const captureTemplatePaths = new Set<string>();

	const visitChoice = (choice: IChoice) => {
		if (!choice) return;
		if (visitedChoices.has(choice.id)) return;

		visitedChoices.add(choice.id);

		if (isTemplateChoice(choice) && choice.templatePath) {
			templatePaths.add(choice.templatePath);
		}

		if (
			isCaptureChoice(choice) &&
			choice.createFileIfItDoesntExist?.enabled &&
			choice.createFileIfItDoesntExist.createWithTemplate &&
			choice.createFileIfItDoesntExist.template
		) {
			captureTemplatePaths.add(choice.createFileIfItDoesntExist.template);
		}

		if (isMultiChoice(choice) && Array.isArray(choice.choices)) {
			for (const child of choice.choices) {
				visitChoice(child);
			}
		}

		if (isMacroChoice(choice)) {
			visitCommands(choice.macro.commands);
		}
	};

	const visitCommands = (commands: ICommand[]) => {
		for (const command of commands) {
			if (!command) continue;

			switch (command.type) {
				case CommandType.Choice: {
					const choiceCommand = command as IChoiceCommand;
					const targetEntry = catalog.get(choiceCommand.choiceId);
					if (targetEntry) visitChoice(targetEntry.choice);
					break;
				}
				case CommandType.NestedChoice: {
					const nested = command as INestedChoiceCommand;
					if (nested.choice) visitChoice(nested.choice);
					break;
				}
				case CommandType.Conditional: {
					const conditional = command as IConditionalCommand;
					visitCommands(conditional.thenCommands);
					visitCommands(conditional.elseCommands);
					break;
				}
				default:
					break;
			}
		}
	};

	for (const id of choiceIds) {
		const entry = catalog.get(id);
		if (entry) visitChoice(entry.choice);
	}

	return { templatePaths, captureTemplatePaths };
}
