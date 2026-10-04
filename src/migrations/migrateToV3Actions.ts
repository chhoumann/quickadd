import { log } from "src/logger/logManager";
import type QuickAdd from "src/main";
import { DEFAULT_SETTINGS } from "src/settings";
import { lowerNode } from "src/v3/lower";
import { migrateSettingsV2 } from "src/v3/migrate";
import { settingsTreeHasUnreadableData } from "./helpers/choice-traversal";
import type { Migration, MigrationContext, MigrationResult } from "./Migrations";

export const V2_SNAPSHOT = "data.v2.json";

/**
 * The bytes of data.json, read before any migration of this launch runs.
 * Migrations change settings in memory only, but a store change can schedule
 * a save, so later in the launch the file may no longer be what the user had.
 * Undefined when the file exists and could not be read.
 */
export async function readDataJson(plugin: QuickAdd): Promise<MigrationContext["dataJson"]> {
	try {
		const path = `${plugin.manifest.dir}/data.json`;
		const adapter = plugin.app.vault.adapter;
		return { bytes: (await adapter.exists(path)) ? await adapter.readBinary(path) : null };
	} catch (error) {
		log.logWarning(`QuickAdd could not read data.json to keep a copy before migrating: ${String(error)}`);
		return undefined;
	}
}

/**
 * Writes the data.json bytes next to it, never over another file. Returns the
 * file name, or undefined when it could not be written.
 */
async function writeSnapshot(plugin: QuickAdd, bytes: ArrayBuffer): Promise<string | undefined> {
	const adapter = plugin.app.vault.adapter;
	const dir = plugin.manifest.dir;
	try {
		let name = V2_SNAPSHOT;
		if (await adapter.exists(`${dir}/${name}`)) {
			if (sameBytes(await adapter.readBinary(`${dir}/${name}`), bytes)) return name;
			// No colons: Windows and Android file names cannot hold them.
			name = `data.v2.${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
		}
		await adapter.writeBinary(`${dir}/${name}`, bytes);
		return name;
	} catch (error) {
		log.logWarning(`QuickAdd could not keep a copy of data.json before migrating: ${String(error)}`);
		return undefined;
	}
}

function sameBytes(a: ArrayBuffer, b: ArrayBuffer): boolean {
	if (a.byteLength !== b.byteLength) return false;
	const left = new Uint8Array(a);
	const right = new Uint8Array(b);
	return left.every((byte, index) => byte === right[index]);
}

/**
 * Moves the choices to QuickAdd 3 actions. data.json then stores `actions`
 * and no `choices`; in memory the plugin keeps working on the choices the
 * actions lower to (src/v3/storage.ts). Runs last, on settings every earlier
 * migration has brought to the current v2 shape, and only after the original
 * data.json is safe in data.v2.json.
 */
const migrateToV3Actions: Migration = {
	description: "Store choices as QuickAdd 3 actions",
	migrate: async (plugin, context): Promise<MigrationResult | void> => {
		const settings = plugin.settings;
		const pending = Object.keys(DEFAULT_SETTINGS.migrations).filter(
			(key) => key !== "migrateToV3Actions" && !settings.migrations[key as keyof typeof settings.migrations],
		);
		if (pending.length > 0) {
			log.logMessage(`QuickAdd waits for ${pending.join(", ")} before moving choices to actions.`);
			return { complete: false };
		}
		if (settingsTreeHasUnreadableData(settings)) {
			log.logMessage("QuickAdd could not read part of the choice list, so it was left as is to be migrated later.");
			return { complete: false };
		}
		if (!context?.dataJson) return { complete: false };
		const snapshot = context.dataJson.bytes ? await writeSnapshot(plugin, context.dataJson.bytes) : null;
		if (snapshot === undefined) return { complete: false };

		const { actions } = migrateSettingsV2({ choices: settings.choices });
		settings.choices = JSON.parse(JSON.stringify(actions.map(lowerNode)));
		settings.v3Migration = { migratedIn: plugin.manifest.version, ...(snapshot ? { snapshot } : {}) };
	},
};

export default migrateToV3Actions;
