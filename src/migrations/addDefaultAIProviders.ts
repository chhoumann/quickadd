import { DefaultProviders } from "src/ai/Provider";
import type { Migration } from "./Migrations";
import { settingsStore } from "src/settingsStore";
import { deepClone } from "src/utils/deepClone";

const addDefaultAIProviders: Migration = {
	description: "Add default AI providers to the settings.",

	migrate: async (_) => {
		const ai = settingsStore.getState().ai;

		// Clone the defaults before mutating. DefaultProviders is a shared module
		// global: mutating a provider in place would bake the user's legacy API
		// key into the global (leaking it into every later read of the defaults)
		// and store references to the same objects, aliasing settings.providers to
		// the global so edits to one would silently change the other.
		const providers = deepClone(DefaultProviders);

		if ("OpenAIApiKey" in ai && typeof ai.OpenAIApiKey === "string") {
			const openAiProvider = providers.find(
				(provider) => provider.name === "OpenAI",
			);
			if (openAiProvider) {
				openAiProvider.apiKey = ai.OpenAIApiKey;
			}
		}

		if ("OpenAIApiKey" in ai) {
			delete ai.OpenAIApiKey;
		}

		settingsStore.setState({
			ai: {
				...settingsStore.getState().ai,
				providers,
			},
		});
	},
};

export default addDefaultAIProviders;
