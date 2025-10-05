import { settingsStore } from "src/settingsStore";
import type { Migration } from "./Migrations";

/**
 * This was used with v. 0.14.0, which was the release version prior to the update modal release.
 * Previously, it set the version to 0.14.0, but now we want to set it to the current version.
 * It would otherwise break the plugin for new users.
 */

const setVersionAfterUpdateModalRelease: Migration = {
	description: "Set version to the current plugin version.",

	migrate: async (plugin) => {
		settingsStore.setState({ version: plugin.manifest.version });
	},
};

export default setVersionAfterUpdateModalRelease;
