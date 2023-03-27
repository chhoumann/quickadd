import { settingsStore } from "src/settingsStore";
import type { Migration } from "./Migrations";

const setVersionAfterUpdateModalRelease: Migration = {
	description:
		"Set version to 0.14.0, which is the release version prior to the update modal release.",
	// eslint-disable-next-line @typescript-eslint/require-await
	migrate: async (_) => {
		settingsStore.setState({ version: "0.14.0" });
	},
};

export default setVersionAfterUpdateModalRelease;
