import type QuickAdd from "src/main";
import type { QuickAddSettings } from "src/settings";

/**
 * Result a migration may return to keep itself pending.
 *
 * Migrations are run exactly once and then flagged complete forever, so a
 * migration that could not finish its work this launch (e.g. an environment
 * that lacks a required capability, or a transient failure) must be able to
 * stay pending and retry on a later launch. Returning `{ complete: false }`
 * keeps the migration's flag unset; any partial progress it persisted to the
 * settings store is still kept. Returning `void`/`undefined` means "done" -
 * there is no `{ complete: true }`, since that is just `void`.
 */
export type MigrationResult = { complete: false };

/** What `migrate` learned before the first migration of a launch ran. */
export type MigrationContext = {
	/**
	 * data.json as it was on disk; `bytes` is null when there was none. Read
	 * only while the QuickAdd 3 migration is pending; undefined otherwise or
	 * when the read failed.
	 */
	dataJson?: { bytes: ArrayBuffer | null };
};

export type Migration = {
	description: string;
	migrate: (plugin: QuickAdd, context?: MigrationContext) => Promise<MigrationResult | void>;
};

export type Migrations = {
	[key in keyof QuickAddSettings["migrations"]]: Migration;
};
