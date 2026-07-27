import { log } from "src/logger/logManager";
import type QuickAdd from "src/main";
import type IMacroChoice from "src/types/choices/IMacroChoice";
import { MacroChoice } from "src/types/choices/MacroChoice";
import { flattenChoices } from "src/utils/choiceUtils";
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
		// the old `macros` array. With an unreadable root there is nowhere to move
		// them to, so finishing would delete them outright - and being flagged
		// complete, it would never retry. Stay pending instead, so a user who
		// repairs data.json by hand still gets their macros migrated (#1566).
		if (!Array.isArray(settings.choices)) {
			log.logMessage(
				"QuickAdd could not read the choice list, so legacy macros were left in place to be migrated later.",
			);
			return { complete: false };
		}

		// Check if we have the old macros array
		const oldMacros = settings.macros ?? [];

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
