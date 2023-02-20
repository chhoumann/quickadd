import { log } from "src/logger/logManager";
import QuickAdd from "src/main";
import { Migrations } from "./Migrations";
import migrateToMacroIDFromEmbeddedMacro from "./migrateToMacroIDFromEmbeddedMacro";
import useQuickAddTemplateFolder from "./useQuickAddTemplateFolder";
import incrementFileNameSettingMoveToDefaultBehavior from "./incrementFileNameSettingMoveToDefaultBehavior";

const migrations: Migrations = {
	migrateToMacroIDFromEmbeddedMacro,
	useQuickAddTemplateFolder,
	incrementFileNameSettingMoveToDefaultBehavior
};

async function migrate(plugin: QuickAdd): Promise<void> {
	const migrationsToRun = Object.keys(migrations).filter(
		(migration: keyof Migrations) => !plugin.settings.migrations[migration]
	);

	// Could batch-run with Promise.all, but we want to log each migration as it runs.
	for (const migration of migrationsToRun as (keyof Migrations)[]) {
		log.logMessage(
			`Running migration ${migration}: ${migrations[migration].description}`
		);

		const success = await migrations[migration].migrate(plugin);

		plugin.settings.migrations[migration] = success;

		if (success) {
			log.logMessage(`Migration ${migration} successful.`);
		} else {
			log.logError(`Migration ${migration} failed.`);
		}
	}

	plugin.saveSettings();
}

export default migrate;
