import type QuickAdd from "src/main";
import { settingsStore } from "src/settingsStore";
import type { Migration } from "./Migrations";

const setProviderModelDiscoveryMode: Migration = {
	description:
		"Ensure every AI provider has a discovery mode so browsing works without models.dev",
	migrate: async (_plugin: QuickAdd) => {
		const currentSettings = settingsStore.getState();
		const providers = currentSettings.ai.providers ?? [];
		let updated = false;

		for (const provider of providers) {
			if (!provider.modelSource) {
				provider.modelSource = "auto";
				updated = true;
			}
		}

		if (!updated) {
			return;
		}

		settingsStore.setState((state) => ({
			...state,
			ai: {
				...state.ai,
				providers: structuredClone(providers),
			},
		}));
	},
};

export default setProviderModelDiscoveryMode;
