import { log } from "src/logger/logManager";
import type QuickAdd from "src/main";
import type { Migrations } from "./Migrations";
import useQuickAddTemplateFolder from "./useQuickAddTemplateFolder";
import incrementFileNameSettingMoveToDefaultBehavior from "./incrementFileNameSettingMoveToDefaultBehavior";
import consolidateFileExistsBehavior from "./consolidateFileExistsBehavior";
import repairTemplateFileExistsBehavior from "./repairTemplateFileExistsBehavior";
import mutualExclusionInsertAfterAndWriteToBottomOfFile from "./mutualExclusionInsertAfterAndWriteToBottomOfFile";
import setVersionAfterUpdateModalRelease from "./setVersionAfterUpdateModalRelease";
import addDefaultAIProviders from "./addDefaultAIProviders";
import removeMacroIndirection from "./removeMacroIndirection";
import migrateFileOpeningSettings from "./migrateFileOpeningSettings";
import backfillFileOpeningDefaults from "./backfillFileOpeningDefaults";
import setProviderModelDiscoveryMode from "./setProviderModelDiscoveryMode";
import { deepClone } from "src/utils/deepClone";
import migrateProviderApiKeysToSecretStorage from "./migrateProviderApiKeysToSecretStorage";
import migrateToMultipleTemplateFolders from "./migrateToMultipleTemplateFolders";
import refreshStaleDefaultModelSeeds from "./refreshStaleDefaultModelSeeds";
import pinAiModelRefs from "./pinAiModelRefs";
import { settingsStore } from "src/settingsStore";

const migrations: Migrations = {
	useQuickAddTemplateFolder,
	incrementFileNameSettingMoveToDefaultBehavior,
	consolidateFileExistsBehavior,
	repairTemplateFileExistsBehavior,
	mutualExclusionInsertAfterAndWriteToBottomOfFile,
	setVersionAfterUpdateModalRelease,
	addDefaultAIProviders,
	removeMacroIndirection,
	migrateFileOpeningSettings,
	backfillFileOpeningDefaults,
	setProviderModelDiscoveryMode,
	migrateProviderApiKeysToSecretStorage,
	migrateToMultipleTemplateFolders,
	refreshStaleDefaultModelSeeds,
	pinAiModelRefs,
};

async function migrate(plugin: QuickAdd): Promise<void> {
	const migrationsToRun = Object.keys(migrations).filter(
		(migration: keyof Migrations) => !plugin.settings.migrations[migration]
	);

	if (migrationsToRun.length === 0) {
		log.logMessage("No migrations to run.");

		return;
	}

	settingsStore.replaceState(deepClone(plugin.settings));

	// Could batch-run with Promise.all, but we want to log each migration as it runs.
	for (const migration of migrationsToRun as (keyof Migrations)[]) {
		log.logMessage(
			`Running migration ${migration}: ${migrations[migration].description}`
		);

		const backup = deepClone(plugin.settings);
		const storeBeforeMigration = settingsStore.getState();

		try {
			const result = await migrations[migration].migrate(plugin);

			if (settingsStore.getState() !== storeBeforeMigration) {
				plugin.settings = deepClone(settingsStore.getState());
			}

			// A migration may report that it could not finish (e.g. a required
			// capability was unavailable this launch). Persist any partial
			// progress it made, but leave the flag unset so it retries later.
			const incomplete = result?.complete === false;
			if (!incomplete) {
				plugin.settings.migrations[migration] = true;
			}
			settingsStore.replaceState(deepClone(plugin.settings));

			log.logMessage(
				incomplete
					? `Migration ${migration} incomplete; will retry on a later launch.`
					: `Migration ${migration} successful.`
			);
		} catch (error) {
			log.logError(
				`Migration '${migration}' was unsuccessful. Please create an issue with the following error message: \n\n${error as string}\n\nQuickAdd will now revert to backup.`
			);

			plugin.settings = backup;
			settingsStore.replaceState(deepClone(plugin.settings));
		}
	}

	void plugin.saveSettings();
}

export default migrate;
