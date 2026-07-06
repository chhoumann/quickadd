import type QuickAdd from "../../main";
import type IChoice from "../../types/choices/IChoice";
import type IMacroChoice from "../../types/choices/IMacroChoice";
import type { MultiChoice } from "../../types/choices/MultiChoice";
import type { IConditionalCommand } from "../../types/macros/Conditional/IConditionalCommand";
import { CommandType } from "../../types/macros/CommandType";
import type { ICommand } from "../../types/macros/ICommand";
import type { INestedChoiceCommand } from "../../types/macros/QuickCommands/INestedChoiceCommand";

export type ChoiceVisitor = (choice: IChoice) => void;
export type CommandVisitor = (command: ICommand) => void;

interface Visitors {
	onChoice?: ChoiceVisitor;
	onCommand?: CommandVisitor;
}

function isMultiChoice(choice: IChoice): choice is MultiChoice {
	return choice.type === "Multi";
}

function isMacroChoice(choice: IChoice): choice is IMacroChoice {
	return choice.type === "Macro";
}

function walkChoice(
	choice: IChoice,
	visitors: Visitors,
	visited: Set<IChoice>,
): void {
	if (!choice || typeof choice !== "object") return;
	if (visited.has(choice)) return;

	visited.add(choice);
	visitors.onChoice?.(choice);

	if (isMultiChoice(choice) && Array.isArray(choice.choices)) {
		for (const child of choice.choices) {
			walkChoice(child, visitors, visited);
		}
	}

	if (isMacroChoice(choice)) {
		walkCommands(choice.macro?.commands, visitors, visited);
	}
}

function walkCommands(
	commands: ICommand[] | undefined,
	visitors: Visitors,
	visited: Set<IChoice>,
): void {
	if (!Array.isArray(commands)) return;

	for (const command of commands) {
		if (!command || typeof command !== "object") continue;

		visitors.onCommand?.(command);

		const conditional = command as IConditionalCommand;
		const isConditional =
			command.type === CommandType.Conditional ||
			Array.isArray(conditional.thenCommands) ||
			Array.isArray(conditional.elseCommands);

		if (isConditional) {
			walkCommands(conditional.thenCommands, visitors, visited);
			walkCommands(conditional.elseCommands, visitors, visited);
		}

		const nested = command as INestedChoiceCommand;
		const nestedChoice =
			command.type === CommandType.NestedChoice
				? nested.choice
				: nested.choice && typeof nested.choice === "object"
					? nested.choice
					: undefined;

		if (nestedChoice) {
			walkChoice(nestedChoice, visitors, visited);
		}
	}
}

function walkSettings(
	settings: { choices: IChoice[]; macros?: unknown },
	visitors: Visitors,
): void {
	const visited = new Set<IChoice>();

	for (const choice of settings.choices) {
		walkChoice(choice, visitors, visited);
	}

	const legacyMacros = settings.macros;
	if (Array.isArray(legacyMacros)) {
		for (const macro of legacyMacros) {
			const commands =
				macro && typeof macro === "object"
					? (macro as { commands?: ICommand[] }).commands
					: undefined;
			walkCommands(commands, visitors, visited);
		}
	}
}

export function walkAllChoices(plugin: QuickAdd, visitor: ChoiceVisitor): void {
	walkSettings(
		plugin.settings as { choices: IChoice[]; macros?: unknown },
		{ onChoice: visitor },
	);
}

/**
 * Visit every command reachable from the given choices (macro commands,
 * conditional branches, nested choices, plus pre-consolidation legacy macros).
 */
export function walkAllCommandsInSettings(
	settings: { choices: IChoice[]; macros?: unknown },
	visitor: CommandVisitor,
): void {
	walkSettings(settings, { onCommand: visitor });
}
