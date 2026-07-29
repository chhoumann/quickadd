import { log } from "src/logger/logManager";
import type QuickAdd from "src/main";
import type IMacroChoice from "src/types/choices/IMacroChoice";
import { MacroChoice } from "src/types/choices/MacroChoice";
import {
	flattenChoices,
	treeHasUnreadableChildren,
} from "src/utils/choiceUtils";
import { isUnreadableCommandList, rootMacrosOf } from "src/utils/macroUtils";
import type { Migration, MigrationResult } from "./Migrations";

type LegacySettings = QuickAdd["settings"] & { macros?: LegacyMacro[] };
type LegacyMacro = {
	id: string;
	name: string;
	commands?: IMacroChoice["macro"]["commands"];
	runOnStartup?: boolean;
};
type LegacyMacroChoice = IMacroChoice & { macroId?: string };

const removeMacroIndirection: Migration = {
	description:
		"Remove macro indirection - embed macros directly in macro choices",
	migrate: async (plugin: QuickAdd): Promise<MigrationResult | void> => {
		const settings = plugin.settings as LegacySettings;

		// This migration MOVES legacy macros into the choice tree and then deletes
		// the old `macros` array, so it must see the WHOLE tree before it destroys
		// the source. Any unreadable `choices` value - at the root or in a nested
		// folder - hides choices from flattenChoices below, which would classify
		// the macros they reference as orphaned, duplicate them at the root, and
		// then delete `settings.macros`; the hidden choice would keep a dangling
		// macroId forever, because a completed migration never retries. Stay
		// pending instead, so a vault repaired by hand is still migrated (#1566).
		//
		// It walks with `flattenChoices`, which descends `Multi.choices` only, so it
		// asks the FOLDERS-ONLY question rather than `settingsTreeHasUnreadableData`.
		// Blocking it on an unreadable `macro.commands` it never descends would be
		// pure cost, and pending is not cheap here the way it is for the fileOpening
		// migrations: nothing at runtime resolves `macroId`, so every legacy macro
		// choice in the vault stays dead until this one completes (#1610).
		if (treeHasUnreadableChildren(settings.choices)) {
			log.logMessage(
				"QuickAdd could not read part of the choice list, so legacy macros were left in place to be migrated later.",
			);
			return { complete: false };
		}

		// The one root WRITE among the migrations (`settings.choices.push` below), so
		// it needs its own `Array.isArray` guard rather than leaning on the
		// readability question above: a guard must never be the only thing standing
		// between a corrupt value and a TypeError. Guarding the push ALONE would be
		// worse than the crash - the migration would go on to `delete settings.macros`
		// and lose the orphans it failed to rehome.
		if (!Array.isArray(settings.choices)) {
			log.logMessage(
				"QuickAdd could not read the choice list, so legacy macros were left in place to be migrated later.",
			);
			return { complete: false };
		}

		// A legacy `macros` value that is not an array is as untrusted as the rest of
		// data.json; `?? []` let `{"0": {...}}` through and threw `oldMacros is not
		// iterable`. Stay pending rather than deleting `macros` below having rehomed
		// nothing.
		if (isUnreadableCommandList(settings.macros)) {
			log.logMessage(
				"QuickAdd could not read the legacy macro list, so it was left in place to be migrated later.",
			);
			return { complete: false };
		}

		// Check if we have the old macros array
		const oldMacros = rootMacrosOf<LegacyMacro>(settings.macros);

		// Map macroId → all choices that reference it
		const choicesByMacroId = new Map<string, IMacroChoice[]>();
		const allChoices = flattenChoices(settings.choices);

		for (const choice of allChoices) {
			if (choice.type === "Macro") {
				const macroChoice = choice as LegacyMacroChoice;
				// Check if this has the old macroId property
				if (macroChoice.macroId) {
					const macroId = macroChoice.macroId;
					if (!choicesByMacroId.has(macroId)) {
						choicesByMacroId.set(macroId, []);
					}
					choicesByMacroId.get(macroId)!.push(macroChoice);
				}
			}
		}

		// Process each macro from the old macros array
		for (const macro of oldMacros) {
			// A hole (`null`, a stray primitive) carries no macro to rehome, and
			// dereferencing `macro.id` on one would abort the whole migration.
			if (!macro || typeof macro !== "object") continue;
			// Nor can an entry with no usable identity: with no `id` the lookup below
			// misses, the orphan branch runs, and a nameless MacroChoice is pushed
			// into the choice tree - then made permanent when `macros` is deleted.
			if (typeof macro.id !== "string" || macro.id === "") continue;
			const referencingChoices =
				choicesByMacroId.get(macro.id) ??
				allChoices.filter(
					(c): c is IMacroChoice =>
						c.type === "Macro" && (c as IMacroChoice).macro?.id === macro.id,
				);

			if (referencingChoices.length === 0) {
				// Create new MacroChoice for orphaned macro
				const choice = new MacroChoice(macro.name);
				choice.macro = {
					id: macro.id,
					name: macro.name,
					commands: macro.commands || [],
				};
				choice.runOnStartup = macro.runOnStartup || false;
				settings.choices.push(choice);
			} else {
				// Embed the macro in all referencing choices
				for (const choice of referencingChoices) {
					choice.macro = {
						id: macro.id,
						name: macro.name,
						commands: macro.commands || [],
					};
					// Preserve existing runOnStartup value if already set (for already-embedded macros)
					choice.runOnStartup ??= macro.runOnStartup ?? false;

					// Remove the old macroId property
					delete (choice as LegacyMacroChoice).macroId;
				}
			}
		}

		// Clean up any remaining orphaned macroId references
		// (in case oldMacros was empty but choices still had macroId)
		for (const choice of allChoices) {
			if (choice.type === "Macro") {
				const macroChoice = choice as LegacyMacroChoice;
				if (macroChoice.macroId) {
					log.logMessage(
						`Removing orphaned macroId reference: ${macroChoice.macroId}`,
					);
					delete macroChoice.macroId;
				}
			}
		}

		// Remove the old macros array
		if ("macros" in settings) {
			delete settings.macros;
		}
	},
};

export default removeMacroIndirection;
