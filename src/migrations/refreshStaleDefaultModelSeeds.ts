import {
	CURRENT_MODEL_SEEDS,
	RETIRED_SEED_MODELS,
	type AIProvider,
	type Model,
} from "src/ai/Provider";
import { settingsStore } from "src/settingsStore";
import { deepClone } from "src/utils/deepClone";
import type { Migration } from "./Migrations";

/** Lowercased hostname of an endpoint, or "" when unparsable (scheme optional). */
function endpointHost(endpoint: string): string {
	for (const candidate of [endpoint, `https://${endpoint}`]) {
		try {
			const host = new URL(candidate).hostname.toLowerCase();
			if (host) return host;
		} catch {
			/* try next form */
		}
	}
	return "";
}

/**
 * Only providers pointing at the OFFICIAL endpoints are touched. A custom or
 * proxy provider may legitimately serve models whose names collide with the
 * retired ids, so we never rewrite those.
 */
function seedKeyForProvider(
	provider: AIProvider,
): keyof typeof CURRENT_MODEL_SEEDS | null {
	const host = endpointHost(provider.endpoint ?? "");
	if (host === "api.openai.com") return "openai";
	if (host === "generativelanguage.googleapis.com") return "google";
	if (host === "api.anthropic.com") return "anthropic";
	return null;
}

function refreshProviderModels(
	provider: AIProvider,
	seedKey: keyof typeof CURRENT_MODEL_SEEDS,
): void {
	const retired = new Set(
		seedKey === "anthropic" ? [] : RETIRED_SEED_MODELS[seedKey],
	);
	provider.models = provider.models.filter(
		(model) => !retired.has(model.name),
	);

	const byName = new Map(provider.models.map((model) => [model.name, model]));
	for (const seed of CURRENT_MODEL_SEEDS[seedKey]) {
		const existing = byName.get(seed.name);
		if (existing) {
			// Refresh metadata in place: the seed values were verified against the
			// live provider/model directory at ship time and supersede whatever an
			// older release (or a manual add of the same id) recorded.
			existing.maxTokens = seed.maxTokens;
			existing.maxOutputTokens = seed.maxOutputTokens;
			existing.supportsTemperature = seed.supportsTemperature;
		} else {
			provider.models.push({ ...seed });
		}
	}
}

const refreshStaleDefaultModelSeeds: Migration = {
	description:
		"Refresh built-in AI provider model lists: drop retired models, add the current generation, and turn on auto-sync.",

	migrate: async (_) => {
		const ai = settingsStore.getState().ai;
		const providers = deepClone(ai.providers ?? []);

		const removedModelNames = new Set<string>();
		for (const provider of providers) {
			const seedKey = seedKeyForProvider(provider);
			if (!seedKey) continue;

			const before = provider.models.map((model: Model) => model.name);
			refreshProviderModels(provider, seedKey);
			const after = new Set(
				provider.models.map((model: Model) => model.name),
			);
			for (const name of before) {
				if (!after.has(name)) removedModelNames.add(name);
			}

			// The toggle shipped default-off and was never acted on by any code
			// path, so users could not have meaningfully chosen it. Turning it on
			// is what keeps these lists current without plugin releases; the
			// toggle in provider settings still opts out.
			provider.autoSyncModels = true;
		}

		// A default model that we just removed is retired upstream and would fail
		// on every new AI command. Fall back to asking.
		const defaultModel = removedModelNames.has(ai.defaultModel)
			? "Ask me"
			: ai.defaultModel;

		settingsStore.setState({
			ai: {
				...settingsStore.getState().ai,
				defaultModel,
				providers,
			},
		});
	},
};

export default refreshStaleDefaultModelSeeds;
