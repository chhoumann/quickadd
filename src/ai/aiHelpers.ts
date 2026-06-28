import { settingsStore } from "src/settingsStore";
import { estimateModelInputBudget } from "./tokenEstimator";

/** Conservative context-window fallback when no model is known or configured. */
const FALLBACK_MODEL_MAX_TOKENS = 4096;

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

/**
 * Largest context window among all configured models, or a conservative
 * fallback when none are configured. Used when the selected model is unknown at
 * config time (see getMaxChunkTokensUpperBound).
 */
export function getLargestModelMaxTokens(): number {
	const aiSettings = settingsStore.getState().ai;

	const tokens = aiSettings.providers
		.flatMap((provider) => provider.models)
		.map((model) => model.maxTokens)
		.filter((value) => Number.isFinite(value) && value > 0);

	return tokens.length ? Math.max(...tokens) : FALLBACK_MODEL_MAX_TOKENS;
}

/**
 * Upper bound for the "Max Chunk Tokens" slider: the model's estimated input
 * budget minus the system-prompt overhead, floored at 1.
 *
 * The selected model can be unknown at config time — the "Ask me" sentinel
 * (resolved at runtime) or a model that was removed from settings. In that case
 * we fall back to the most permissive configured model instead of throwing,
 * which would blank the settings modal. The runtime still caps each chunk to the
 * actual model's budget, so a generous UI bound never lets a request exceed the
 * real limit.
 */
export function getMaxChunkTokensUpperBound(
	modelName: string,
	systemPromptTokens: number,
): number {
	const model = getModelByName(modelName);
	const maxTokens = model?.maxTokens ?? getLargestModelMaxTokens();

	return Math.max(1, estimateModelInputBudget(maxTokens) - systemPromptTokens);
}
