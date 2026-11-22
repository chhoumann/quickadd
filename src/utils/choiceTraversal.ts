import type IChoice from "../types/choices/IChoice";
import { isMacroChoice, isMultiChoice } from "../types/choices/choiceGuards";
import type { IConditionalCommand } from "../types/macros/Conditional/IConditionalCommand";
import { CommandType } from "../types/macros/CommandType";
import type { ICommand } from "../types/macros/ICommand";
import type { INestedChoiceCommand } from "../types/macros/QuickCommands/INestedChoiceCommand";
import { isUnreadableChoiceList } from "./choiceUtils";
import {
	isUnreadableCommandList,
	macroCommandsValueOf,
} from "./macroUtils";

type ChoiceVisitor = (choice: IChoice) => void;
type CommandVisitor = (command: ICommand) => void;

interface Visitors {
	onChoice?: ChoiceVisitor;
	onCommand?: CommandVisitor;
	/**
	 * Called with every container value this walk had to step over because it
	 * could not read it. What makes `settingsTreeHasUnreadableData` trustworthy:
	 * the guard is the walk, so it cannot answer for a subtree the walk enters
	 * (or skips) differently.
	 */
	onUnreadable?: () => void;
}

function walkChoice(
	choice: IChoice,
	visitors: Visitors,
	visited: Set<IChoice>,
): void {
	if (!choice || typeof choice !== "object") return;
	// A nested list (spliced in by the editor seam) can carry choices. It is
	// reported unreadable rather than descended: narrower traversals such as
	// flattenChoices step past it, and descending here would let the guard answer
	// for them. The seam repairs it the next time the settings tab opens.
	if (Array.isArray(choice)) {
		visitors.onUnreadable?.();
		return;
	}
	if (visited.has(choice)) return;

	visited.add(choice);
	visitors.onChoice?.(choice);

	if (isMultiChoice(choice)) {
		if (Array.isArray(choice.choices)) {
			for (const child of choice.choices) {
				walkChoice(child, visitors, visited);
			}
		} else if (isUnreadableChoiceList(choice.choices)) {
			visitors.onUnreadable?.();
		}
	}

	if (isMacroChoice(choice)) {
		// An array-valued `macro` is the command list; reading `.commands` off it
		// would walk nothing and report readable.
		walkCommands(macroCommandsValueOf(choice.macro), visitors, visited);
	}
}

function walkCommands(
	commands: unknown,
	visitors: Visitors,
	visited: Set<IChoice>,
): void {
	if (!Array.isArray(commands)) {
		if (isUnreadableCommandList(commands)) visitors.onUnreadable?.();
		return;
	}

	for (const command of commands) {
		if (!command || typeof command !== "object") continue;
		// Same reasoning as the choice side: a nested list can be carrying commands,
		// and reporting it is honest about what the narrower walkers see.
		if (Array.isArray(command)) {
			visitors.onUnreadable?.();
			continue;
		}

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

	// The root is judged strictly: settings merge over DEFAULT_SETTINGS, so a
	// missing `choices` is already [] and any non-array root is corruption.
	// Containers below it use the "could this carry data" rule.
	if (Array.isArray(settings.choices)) {
		for (const choice of settings.choices) {
			walkChoice(choice, visitors, visited);
		}
	} else {
		visitors.onUnreadable?.();
	}

	const legacyMacros = settings.macros;
	if (Array.isArray(legacyMacros)) {
		for (const macro of legacyMacros) {
			walkCommands(macroCommandsValueOf(macro), visitors, visited);
		}
	} else if (isUnreadableCommandList(legacyMacros)) {
		// A pre-consolidation vault keeps its macros here, and this container is
		// as untrusted as the others. `undefined` is the NORMAL post-migration
		// state, so only a value that could still be carrying macros counts.
		visitors.onUnreadable?.();
	}
}

/**
 * Whether anything is hidden from {@link walkChoicesInSettings} behind a
 * container it could not read. A migration that moves data must then return
 * `{ complete: false }` and retry later, or the hidden subtree is never
 * migrated. Derived from the walk itself, so it cannot answer for a subtree the
 * walk handles differently. Ask it only when migrating through
 * walkChoicesInSettings; narrower traversals ask `treeHasUnreadableChildren`.
 */
export function settingsTreeHasUnreadableData(settings: {
	choices: IChoice[];
	macros?: unknown;
}): boolean {
	let unreadable = false;
	walkSettings(settings, {
		onUnreadable: () => {
			unreadable = true;
		},
	});
	return unreadable;
}

/**
 * Visit `choice` and every choice below it: folder children, and choices its
 * macro commands (including conditional branches) run as nested choices.
 */
export function walkChoiceTree(choice: IChoice, visitor: ChoiceVisitor): void {
	walkChoice(choice, { onChoice: visitor }, new Set<IChoice>());
}

/**
 * Visit every choice in `settings`: root choices, folder children, choices
 * macros run as nested steps (conditional branches included), and choices in
 * pre-consolidation legacy macros.
 */
export function walkChoicesInSettings(
	settings: { choices: IChoice[]; macros?: unknown },
	visitor: ChoiceVisitor,
): void {
	walkSettings(settings, { onChoice: visitor });
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
