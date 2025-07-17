/**
 * DEPRECATED  ──────────────────────────────────────────────────────────────
 * This migration used to convert embedded macros into the older `macroId`
 * indirection format.  The data model has moved back to "embedded macros",
 * so running this migration would be destructive.  It is therefore turned
 * into a NO-OP and should never be invoked by the normal migration runner.
 */
import type QuickAdd from "src/main";
import type { Migration } from "./Migrations";
import { log } from "src/logger/logManager";

const migrateToMacroIDFromEmbeddedMacro: Migration = {
	description: "[DEPRECATED] No-op ‑ embedded → macroId migration removed",
	migrate: async (_plugin: QuickAdd): Promise<void> => {
		log.logMessage(
			"❎  Skipping obsolete migration 'migrateToMacroIDFromEmbeddedMacro'."
		);
	},
};

export default migrateToMacroIDFromEmbeddedMacro;
