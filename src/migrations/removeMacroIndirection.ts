import { log } from "src/logger/logManager";
import type { MigrationContext } from "../types/pluginContext";
import type { QuickAddSettings } from "../settings";
import type IMacroChoice from "src/types/choices/IMacroChoice";
import { MacroChoice } from "src/types/choices/MacroChoice";
import {
	flattenChoices,
	treeHasUnreadableChildren,
} from "src/utils/choiceUtils";
import { isUnreadableCommandList, rootMacrosOf } from "src/utils/macroUtils";
import type { Migration, MigrationResult } from "./Migrations";

type LegacySettings = QuickAddSettings & { macros?: LegacyMacro[] };
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
	migrate: async (plugin: MigrationContext): Promise<MigrationResult | void> => {
		const settings = plugin.settings as LegacySettings;

		// This migration moves legacy macros into the tree and deletes `macros`, so
		// it must see the whole tree first: an unreadable `choices` would make the
		// macros it hides look orphaned and leave dangling macroIds forever. It walks
		// with flattenChoices, so it asks the folders-only question rather than
		// settingsTreeHasUnreadableData, which would block it on commands it never
		// reads.
		if (treeHasUnreadableChildren(settings.choices)) {
			log.logMessage(
				"QuickAdd could not read part of the choice list, so legacy macros were left in place to be migrated later.",
			);
			return { complete: false };
		}

		// The one root write among the migrations, so it needs its own guard;
		// guarding only the push would go on to delete `macros` and lose the
		// orphans it failed to rehome.
		if (!Array.isArray(settings.choices)) {
			log.logMessage(
				"QuickAdd could not read the choice list, so legacy macros were left in place to be migrated later.",
			);
			return { complete: false };
		}

		// A non-array legacy `macros` stays pending rather than deleting `macros`
		// below having rehomed nothing.
		if (isUnreadableCommandList(settings.macros)) {
			log.logMessage(
				"QuickAdd could not read the legacy macro list, so it was left in place to be migrated later.",
			);
			return { complete: false };
		}

		const oldMacros = rootMacrosOf<LegacyMacro>(settings.macros);

		// Map macroId → all choices that reference it
		const choicesByMacroId = new Map<string, IMacroChoice[]>();
		const allChoices = flattenChoices(settings.choices);

		for (const choice of allChoices) {
			if (choice.type === "Macro") {
				const macroChoice = choice as LegacyMacroChoice;
				if (macroChoice.macroId) {
					const macroId = macroChoice.macroId;
					if (!choicesByMacroId.has(macroId)) {
						choicesByMacroId.set(macroId, []);
					}
					choicesByMacroId.get(macroId)!.push(macroChoice);
				}
			}
		}

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
				const choice = new MacroChoice(macro.name);
				choice.macro = {
					id: macro.id,
					name: macro.name,
					commands: macro.commands || [],
				};
				choice.runOnStartup = macro.runOnStartup || false;
				settings.choices.push(choice);
			} else {
				for (const choice of referencingChoices) {
					choice.macro = {
						id: macro.id,
						name: macro.name,
						commands: macro.commands || [],
					};
					// Preserve existing runOnStartup value if already set (for already-embedded macros)
					choice.runOnStartup ??= macro.runOnStartup ?? false;

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

		if ("macros" in settings) {
			delete settings.macros;
		}
	},
};

export default removeMacroIndirection;
