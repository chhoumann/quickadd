import { log } from "src/logger/logManager";
import type QuickAdd from "src/main";
import type { Migrations } from "./Migrations";
import useQuickAddTemplateFolder from "./useQuickAddTemplateFolder";
import incrementFileNameSettingMoveToDefaultBehavior from "./incrementFileNameSettingMoveToDefaultBehavior";
import mutualExclusionInsertAfterAndWriteToBottomOfFile from "./mutualExclusionInsertAfterAndWriteToBottomOfFile";
import setVersionAfterUpdateModalRelease from "./setVersionAfterUpdateModalRelease";
import addDefaultAIProviders from "./addDefaultAIProviders";
import removeMacroIndirection from "./removeMacroIndirection";
import migrateFileOpeningSettings from "./migrateFileOpeningSettings";
import backfillFileOpeningDefaults from "./backfillFileOpeningDefaults";
import setProviderModelDiscoveryMode from "./setProviderModelDiscoveryMode";
import { deepClone } from "src/utils/deepClone";
import migrateProviderApiKeysToSecretStorage from "./migrateProviderApiKeysToSecretStorage";

const migrations: Migrations = {
	useQuickAddTemplateFolder,
	incrementFileNameSettingMoveToDefaultBehavior,
	mutualExclusionInsertAfterAndWriteToBottomOfFile,
	setVersionAfterUpdateModalRelease,
	addDefaultAIProviders,
	removeMacroIndirection,
	migrateFileOpeningSettings,
	backfillFileOpeningDefaults,
	setProviderModelDiscoveryMode,
	migrateProviderApiKeysToSecretStorage,
};

async function migrate(plugin: QuickAdd): Promise<void> {
	const migrationsToRun = Object.keys(migrations).filter(
		(migration: keyof Migrations) => !plugin.settings.migrations[migration]
	);

	if (migrationsToRun.length === 0) {
		log.logMessage("No migrations to run.");

		return;
	}

	// Could batch-run with Promise.all, but we want to log each migration as it runs.
	for (const migration of migrationsToRun as (keyof Migrations)[]) {
		log.logMessage(
			`Running migration ${migration}: ${migrations[migration].description}`
		);

		const backup = deepClone(plugin.settings);

		try {
			await migrations[migration].migrate(plugin);

			plugin.settings.migrations[migration] = true;

			log.logMessage(`Migration ${migration} successful.`);
		} catch (error) {
			log.logError(
				`Migration '${migration}' was unsuccessful. Please create an issue with the following error message: \n\n${error as string}\n\nQuickAdd will now revert to backup.`
			);

			plugin.settings = backup;
		}
	}

	void plugin.saveSettings();
}

export default migrate;
