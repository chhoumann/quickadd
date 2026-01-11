import type QuickAdd from "../../main";
import type IChoice from "../../types/choices/IChoice";
import type IMacroChoice from "../../types/choices/IMacroChoice";
import type { MultiChoice } from "../../types/choices/MultiChoice";
import type { IConditionalCommand } from "../../types/macros/Conditional/IConditionalCommand";
import { CommandType } from "../../types/macros/CommandType";
import type { ICommand } from "../../types/macros/ICommand";
import type { INestedChoiceCommand } from "../../types/macros/QuickCommands/INestedChoiceCommand";

export type ChoiceVisitor = (choice: IChoice) => void;

function isMultiChoice(choice: IChoice): choice is MultiChoice {
	return choice.type === "Multi";
}

function isMacroChoice(choice: IChoice): choice is IMacroChoice {
	return choice.type === "Macro";
}

function walkChoice(
	choice: IChoice,
	visitor: ChoiceVisitor,
	visited: Set<IChoice>,
): void {
	if (!choice || typeof choice !== "object") return;
	if (visited.has(choice)) return;

	visited.add(choice);
	visitor(choice);

	if (isMultiChoice(choice) && Array.isArray(choice.choices)) {
		for (const child of choice.choices) {
			walkChoice(child, visitor, visited);
		}
	}

	if (isMacroChoice(choice)) {
		walkCommands(choice.macro?.commands, visitor, visited);
	}
}

function walkCommands(
	commands: ICommand[] | undefined,
	visitor: ChoiceVisitor,
	visited: Set<IChoice>,
): void {
	if (!Array.isArray(commands)) return;

	for (const command of commands) {
		if (!command || typeof command !== "object") continue;

		const conditional = command as IConditionalCommand;
		const isConditional =
			command.type === CommandType.Conditional ||
			Array.isArray(conditional.thenCommands) ||
			Array.isArray(conditional.elseCommands);

		if (isConditional) {
			walkCommands(conditional.thenCommands, visitor, visited);
			walkCommands(conditional.elseCommands, visitor, visited);
		}

		const nested = command as INestedChoiceCommand;
		const nestedChoice =
			command.type === CommandType.NestedChoice
				? nested.choice
				: nested.choice && typeof nested.choice === "object"
					? nested.choice
					: undefined;

		if (nestedChoice) {
			walkChoice(nestedChoice, visitor, visited);
		}
	}
}

export function walkAllChoices(plugin: QuickAdd, visitor: ChoiceVisitor): void {
	const visited = new Set<IChoice>();

	for (const choice of plugin.settings.choices) {
		walkChoice(choice, visitor, visited);
	}

	const legacyMacros = (plugin.settings as any).macros;
	if (Array.isArray(legacyMacros)) {
		for (const macro of legacyMacros) {
			walkCommands(macro?.commands, visitor, visited);
		}
	}
}
