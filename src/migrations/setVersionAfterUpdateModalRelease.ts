import { settingsStore } from "src/settingsStore";
import type { Migration } from "./Migrations";

/**
 * Sets the stored version to the current plugin version, so a new install is
 * not treated as an upgrade by the update modal.
 */

const setVersionAfterUpdateModalRelease: Migration = {
	description: "Set version to the current plugin version.",
	 
	migrate: async (plugin) => {
		settingsStore.setState({ version: plugin.manifest.version });
	},
};

export default setVersionAfterUpdateModalRelease;
