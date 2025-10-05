import { DefaultProviders } from "src/ai/Provider";
import type { Migration } from "./Migrations";
import { settingsStore } from "src/settingsStore";

const addDefaultAIProviders: Migration = {
	description: "Add default AI providers to the settings.",

	migrate: async (_) => {
		const ai = settingsStore.getState().ai;

		const defaultProvidersWithOpenAIKey = DefaultProviders.map((provider) => {
			if (provider.name === "OpenAI") {
				if ("OpenAIApiKey" in ai && typeof ai.OpenAIApiKey === "string") {
					provider.apiKey = ai.OpenAIApiKey;
				}
			}

			return provider;
		});

		if ("OpenAIApiKey" in ai) {
			delete ai.OpenAIApiKey;
		}

		settingsStore.setState({
			ai: {
				...settingsStore.getState().ai,
				providers: defaultProvidersWithOpenAIKey,
			},
		});
	},
};

export default addDefaultAIProviders;
