import { log } from "src/logger/logManager";
import type QuickAdd from "src/main";
import type IMacroChoice from "src/types/choices/IMacroChoice";
import { MacroChoice } from "src/types/choices/MacroChoice";
import { flattenChoices } from "src/utils/choiceUtils";
import type { Migration } from "./Migrations";

const removeMacroIndirection: Migration = {
	description:
		"Remove macro indirection - embed macros directly in macro choices",
	migrate: async (plugin: QuickAdd) => {
		const settings = plugin.settings;

		// Check if we have the old macros array
		const oldMacros = (settings as any).macros || [];

		// Map macroId → all choices that reference it
		const choicesByMacroId = new Map<string, IMacroChoice[]>();
		const allChoices = flattenChoices(settings.choices);

		for (const choice of allChoices) {
			if (choice.type === "Macro") {
				const macroChoice = choice as IMacroChoice;
				// Check if this has the old macroId property
				if ((macroChoice as any).macroId) {
					const macroId = (macroChoice as any).macroId;
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
					delete (choice as any).macroId;
				}
			}
		}

		// Clean up any remaining orphaned macroId references
		// (in case oldMacros was empty but choices still had macroId)
		for (const choice of allChoices) {
			if (choice.type === "Macro") {
				const macroChoice = choice as IMacroChoice;
				if ((macroChoice as any).macroId) {
					log.logMessage(
						`Removing orphaned macroId reference: ${(macroChoice as any).macroId}`,
					);
					delete (macroChoice as any).macroId;
				}
			}
		}

		// Remove the old macros array
		if ("macros" in settings) {
			delete (settings as any).macros;
		}
	},
};

export default removeMacroIndirection;
