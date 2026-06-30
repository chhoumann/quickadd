import type QuickAdd from "src/main";
import type { QuickAddSettings } from "src/settings";

/**
 * Result a migration may return to control whether it is marked done.
 *
 * Migrations are run exactly once and then flagged complete forever, so a
 * migration that could not finish its work this launch (e.g. an environment
 * that lacks a required capability, or a transient failure) must be able to
 * stay pending and retry on a later launch. Returning `{ complete: false }`
 * keeps the migration's flag unset; any partial progress it persisted to the
 * settings store is still kept. Returning `void`/`undefined` means "done".
 */
export type MigrationResult = { complete: boolean };

export type Migration = {
	description: string;
	migrate: (plugin: QuickAdd) => Promise<MigrationResult | void>;
};

export type Migrations = {
	[key in keyof Omit<QuickAddSettings["migrations"], "migrateToMacroIDFromEmbeddedMacro">]: Migration;
};
