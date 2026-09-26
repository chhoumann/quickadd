import type { App } from "obsidian";
import { log } from "src/logger/logManager";
import { settingsStore } from "src/settingsStore";
import { discoverProviderModels } from "./modelDiscoveryService";
import { mergeSyncedModels } from "./modelsDirectory";
import type { AIProvider, Model } from "./Provider";
import { resolveProviderApiKey } from "./providerSecrets";

const AUTO_SYNC_INTERVAL_MS = 24 * 60 * 60 * 1000;

export interface ProviderSyncOutcome {
	provider: string;
	added: number;
	updated: number;
	/** Message when this provider's sync failed; undefined on success. */
	error?: string;
}

/**
 * How `after` differs from `before`, matched by model name: entries that are
 * new, and entries whose metadata (context/output/sampling) changed.
 */
export function diffModelLists(
	before: Model[],
	after: Model[],
): { added: number; updated: number } {
	const beforeByName = new Map(before.map((m) => [m.name, JSON.stringify(m)]));
	let added = 0;
	let updated = 0;
	for (const model of after) {
		const prev = beforeByName.get(model.name);
		if (prev === undefined) added += 1;
		else if (prev !== JSON.stringify(model)) updated += 1;
	}
	return { added, updated };
}

/**
 * Discover the provider's current models and merge them into its list:
 * new models are appended, existing ones get their context/output/sampling
 * metadata refreshed; models marked deprecated upstream are never added.
 * Mutates `provider.models` and records `provider.lastModelSync` (also on
 * failure, before rethrowing); never removes entries.
 * Returns what this call changed plus the discovered list, so callers holding
 * another copy of the provider (e.g. an edit snapshot) can merge it too.
 */
export async function syncProviderModels(
	app: App | undefined,
	provider: AIProvider,
): Promise<{ added: number; updated: number; discovered: Model[] }> {
	let discovered: Model[];
	try {
		const apiKey = await resolveProviderApiKey(app, provider);
		discovered = await discoverProviderModels(provider, apiKey);
	} catch (err) {
		provider.lastModelSync = {
			at: Date.now(),
			error: syncFailureMessage(err),
		};
		throw err;
	}
	const before = provider.models;
	provider.models = mergeSyncedModels(provider.models, discovered);
	provider.lastModelSync = { at: Date.now() };
	return { ...diffModelLists(before, provider.models), discovered };
}

/**
 * Nonempty message for a failed sync. An empty `Error("")` message must not
 * be stored as `error: ""` — consumers treat that as success via truthiness.
 */
function syncFailureMessage(err: unknown): string {
	const message = (err as Error)?.message;
	if (typeof message === "string" && message.length > 0) return message;
	const asString = String(err);
	return asString.length > 0 ? asString : "Unknown error";
}

/**
 * Stable identity for matching a synced provider back into current state.
 * Prefer the unique provider `id`; fall back to name+endpoint only for
 * pre-migration data that still lacks one.
 */
function providerIdentity(provider: AIProvider): string {
	if (provider.id) return `id:${provider.id}`;
	return `ne:${(provider.name ?? "").trim().toLowerCase()}\u0000${(
		provider.endpoint ?? ""
	)
		.trim()
		.toLowerCase()
		.replace(/\/+$/, "")}`;
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

	// Sync against detached copies; the user may edit settings while requests
	// are in flight, so results are merged back per provider below instead of
	// writing this snapshot over whatever the state has become.
	const outcomes: ProviderSyncOutcome[] = [];
	const synced = new Map<string, AIProvider>();
	for (const provider of enabled) {
		const copy: AIProvider = {
			...provider,
			models: provider.models.map((model) => ({ ...model })),
		};
		try {
			const { added, updated } = await syncProviderModels(app, copy);
			outcomes.push({ provider: copy.name, added, updated });
			synced.set(providerIdentity(copy), copy);
		} catch (err) {
			outcomes.push({
				provider: copy.name,
				added: 0,
				updated: 0,
				error: syncFailureMessage(err),
			});
			// Carries the failure in lastModelSync so settings can show it.
			synced.set(providerIdentity(copy), copy);
		}
	}

	const anySucceeded = outcomes.some((outcome) => !outcome.error);

	settingsStore.setState((current) => ({
		...current,
		ai: {
			...current.ai,
			// Merge each synced model list into the provider as it exists NOW,
			// keyed by provider id (name+endpoint only as a pre-id fallback).
			// Providers the user removed mid-sync stay removed; providers the
			// user edited keep those edits.
			providers: current.ai.providers.map((provider) => {
				const result = synced.get(providerIdentity(provider));
				if (!result) return provider;
				return {
					...provider,
					models: result.lastModelSync?.error
						? provider.models
						: mergeSyncedModels(provider.models, result.models),
					lastModelSync: result.lastModelSync,
				};
			}),
			// A completely failed pass (e.g. Obsidian started offline) must not
			// suppress retries for a day — leave the throttle untouched so the
			// next launch tries again.
			lastModelAutoSyncAt: anySucceeded
				? Date.now()
				: current.ai.lastModelAutoSyncAt,
		},
	}));

	for (const outcome of outcomes) {
		if (outcome.error) {
			log.logMessage(
				`[Model auto-sync] ${outcome.provider}: failed (${outcome.error})`,
			);
		} else if (outcome.added > 0 || outcome.updated > 0) {
			log.logMessage(
				`[Model auto-sync] ${outcome.provider}: ${outcome.added} new model(s), ${outcome.updated} updated.`,
			);
		}
	}

	return outcomes;
}
