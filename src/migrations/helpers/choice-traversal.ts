import type QuickAdd from "../../main";
import type IChoice from "../../types/choices/IChoice";
import type IMacroChoice from "../../types/choices/IMacroChoice";
import type { MultiChoice } from "../../types/choices/MultiChoice";
import type { IConditionalCommand } from "../../types/macros/Conditional/IConditionalCommand";
import { CommandType } from "../../types/macros/CommandType";
import type { ICommand } from "../../types/macros/ICommand";
import type { INestedChoiceCommand } from "../../types/macros/QuickCommands/INestedChoiceCommand";
import { isUnreadableChoiceList } from "../../utils/choiceUtils";
import {
	isUnreadableCommandList,
	macroCommandsValueOf,
} from "../../utils/macroUtils";

export type ChoiceVisitor = (choice: IChoice) => void;
export type CommandVisitor = (command: ICommand) => void;

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
	// An ARRAY entry is a NESTED LIST, which the editor seam splices into the tree
	// (`normalizeChoiceList`) - so it can be CARRYING choices, and `typeof [] ===
	// "object"` means the visitor would otherwise be handed the array itself and
	// descend nothing.
	//
	// Reported unreadable rather than descended, even though this walk could
	// descend it. The narrower migrations cannot: `flattenChoices` pushes the array
	// as if it were a choice, and the increment / mutual-exclusion recursions step
	// straight past it. Descending here would make the guard say "I saw everything"
	// on behalf of traversals that did not, which is exactly the failure #1610 is
	// about. Staying pending costs one launch: the user opens the settings tab, the
	// seam splices the entries into real choices, and the next launch is readable.
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
		// `macroCommandsValueOf`, not `choice.macro?.commands`: an ARRAY-valued
		// `macro` IS the command list (writing `.commands` onto an Array is dropped
		// by JSON.stringify, so that is the only recoverable reading - see #1593).
		// Reading `.commands` off it yields `undefined`, which walks nothing and
		// reports readable, so a nested choice inside such a macro was invisible to
		// every migration AND to the guard that is supposed to notice (#1610).
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

	// The ROOT `choices` is untrusted too: loadSettings deliberately leaves a
	// non-array value in place rather than replacing it with [] (#1566).
	//
	// The root is judged STRICTLY - any non-array is unreadable - while every
	// container below it uses the "could this be carrying data" rule. The
	// asymmetry is not an oversight: `loadSettings` merges over DEFAULT_SETTINGS,
	// so a MISSING `choices` key is already `[]` by the time anything sees it.
	// A root that is not an array is therefore always corruption, never an honest
	// empty - which is why ChoiceView refuses to render it at all rather than
	// showing the "No choices yet" hero whose CTA would write over it.
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
 * Whether anything in `settings` is hidden from {@link walkAllChoices} behind a
 * container it could not read.
 *
 * This is the question a migration that MOVES data has to ask. Migrations run
 * exactly once and are then flagged complete forever, so one that walked past a
 * subtree it could not see would leave that subtree un-migrated permanently -
 * even after the user repairs `data.json` by hand. Such a migration must return
 * `{ complete: false }` instead and retry on a later launch (see
 * `MigrationResult`).
 *
 * Derived from the traversal itself rather than reimplemented alongside it: an
 * independent predicate answered for `Multi.choices` only and never descended
 * `macro.commands`, so a `NestedChoice` inside `"commands": {"0": {...}}` was
 * invisible to both the walk and the guard, and the migrations reported complete
 * anyway (#1610).
 *
 * Ask this only if you migrate through `walkAllChoices`. A migration with its own
 * narrower traversal must ask the narrower question - see
 * `treeHasUnreadableChildren` - or it blocks itself on data it was never going to
 * touch.
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
