import type { App } from "obsidian";
import { log } from "src/logger/logManager";
import { settingsStore } from "src/settingsStore";
import { discoverProviderModels } from "./modelDiscoveryService";
import { mergeModels } from "./modelsDirectory";
import type { AIProvider } from "./Provider";
import { resolveProviderApiKey } from "./providerSecrets";

const AUTO_SYNC_INTERVAL_MS = 24 * 60 * 60 * 1000;

export interface ProviderSyncOutcome {
	provider: string;
	added: number;
	/** Message when this provider's sync failed; undefined on success. */
	error?: string;
}

/**
 * Discover the provider's current models and merge them into its list:
 * new models are appended, existing ones get their context/output/sampling
 * metadata refreshed. Mutates `provider.models`; never removes entries.
 */
export async function syncProviderModels(
	app: App | undefined,
	provider: AIProvider,
): Promise<{ added: number }> {
	const apiKey = await resolveProviderApiKey(app, provider);
	const discovered = await discoverProviderModels(provider, apiKey);
	const before = provider.models.length;
	provider.models = mergeModels(provider.models, discovered);
	return { added: provider.models.length - before };
}

/**
 * Background auto-sync for every provider with the toggle on. This is what
 * keeps model lists and context metadata current WITHOUT plugin releases.
 * Quiet by design: successes and failures go to the log, never to a Notice —
 * it runs on plugin load (throttled to once a day) and when provider settings
 * open, and neither moment should interrupt the user.
 */
export async function autoSyncEnabledProviders(
	app: App | undefined,
	options: { ignoreThrottle?: boolean } = {},
): Promise<ProviderSyncOutcome[]> {
	const state = settingsStore.getState();
	if (state.disableOnlineFeatures) return [];

	const enabled = state.ai.providers.filter((p) => p.autoSyncModels);
	if (enabled.length === 0) return [];

	const lastSyncAt = state.ai.lastModelAutoSyncAt ?? 0;
	if (
		!options.ignoreThrottle &&
		Date.now() - lastSyncAt < AUTO_SYNC_INTERVAL_MS
	) {
		return [];
	}

	const outcomes: ProviderSyncOutcome[] = [];
	// Work on a copy so partially-failed syncs never leave the store torn.
	const providers = state.ai.providers.map((provider) => ({
		...provider,
		models: provider.models.map((model) => ({ ...model })),
	}));

	for (const provider of providers) {
		if (!provider.autoSyncModels) continue;
		try {
			const { added } = await syncProviderModels(app, provider);
			outcomes.push({ provider: provider.name, added });
		} catch (err) {
			outcomes.push({
				provider: provider.name,
				added: 0,
				error: (err as Error).message ?? String(err),
			});
		}
	}

	settingsStore.setState((current) => ({
		...current,
		ai: {
			...current.ai,
			providers,
			lastModelAutoSyncAt: Date.now(),
		},
	}));

	for (const outcome of outcomes) {
		if (outcome.error) {
			log.logMessage(
				`[Model auto-sync] ${outcome.provider}: failed (${outcome.error})`,
			);
		} else if (outcome.added > 0) {
			log.logMessage(
				`[Model auto-sync] ${outcome.provider}: added ${outcome.added} model(s).`,
			);
		}
	}

	return outcomes;
}
