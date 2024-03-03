import { DefaultProviders } from "src/ai/Provider";
import type { Migration } from "./Migrations";
import { settingsStore } from "src/settingsStore";

const addDefaultAIProviders: Migration = {
	description: "Add default AI providers to the settings.",
	// eslint-disable-next-line @typescript-eslint/require-await
	migrate: async (_) => {
		const { OpenAIApiKey } = settingsStore.getState().ai;
		const defaultProvidersWithOpenAIKey = DefaultProviders.map(
			(provider) => {
				if (provider.name === "OpenAI") {
					provider.apiKey = OpenAIApiKey;
				}

				return provider;
			}
		);

		settingsStore.setState({
			ai: {
				...settingsStore.getState().ai,
				providers: defaultProvidersWithOpenAIKey,
			},
		});
	},
};

export default addDefaultAIProviders;
