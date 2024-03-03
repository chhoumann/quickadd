import { settingsStore } from "src/settingsStore";

export function getModelNames() {
	const aiSettings = settingsStore.getState().ai;

	return aiSettings.providers
		.flatMap((provider) => provider.models)
		.map((model) => model.name);
}

export function getModelByName(model: string) {
	const aiSettings = settingsStore.getState().ai;

	return aiSettings.providers
		.flatMap((provider) => provider.models)
		.find((m) => m.name === model);
}

export function getModelMaxTokens(model: string) {
	const aiSettings = settingsStore.getState().ai;

	const modelData = aiSettings.providers
		.flatMap((provider) => provider.models)
		.find((m) => m.name === model);

	if (modelData) {
		return modelData.maxTokens;
	}

	throw new Error(`Model ${model} not found with any provider.`);
}

export function getModelProvider(modelName: string) {
	const aiSettings = settingsStore.getState().ai;

	return aiSettings.providers.find((provider) =>
		provider.models.some((m) => m.name === modelName)
	);
}
