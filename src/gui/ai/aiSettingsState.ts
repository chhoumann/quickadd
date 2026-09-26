import type { AIProvider } from "src/ai/Provider";
import type { QuickAddSettings } from "src/settings";
import { settingsStore } from "src/settingsStore";

type AISettings = QuickAddSettings["ai"];

/**
 * The stored providers, or none. The settings tab builds its definitions
 * before migrations run, and legacy data can lack `ai.providers` until
 * `addDefaultAIProviders` creates it; reading must not throw, and must not
 * write a replacement either.
 */
export function storedProviders(
	state: Pick<QuickAddSettings, "ai"> = settingsStore.getState(),
): AIProvider[] {
	const providers = (state.ai as Partial<AISettings> | undefined)?.providers;
	return Array.isArray(providers) ? providers : [];
}

/**
 * Write helpers for the AI settings pages. Settings pages save as you edit,
 * so every change goes straight through the store (main.ts persists it).
 * Providers are addressed by their stable id, never by object identity: a
 * background sync or another edit may have replaced the object since a page
 * rendered it.
 */
export function updateAISettings(patch: Partial<AISettings>): void {
	settingsStore.setState((state) => ({ ai: { ...state.ai, ...patch } }));
}

export function findProvider(id: string): AIProvider | undefined {
	return storedProviders().find((p) => p.id === id);
}

export function updateProvider(
	id: string,
	update: (provider: AIProvider) => AIProvider,
): void {
	settingsStore.setState((state) => ({
		ai: {
			...state.ai,
			providers: state.ai.providers.map((provider) =>
				provider.id === id ? update(provider) : provider,
			),
		},
	}));
}

export function removeProvider(id: string): void {
	settingsStore.setState((state) => ({
		ai: {
			...state.ai,
			providers: state.ai.providers.filter((provider) => provider.id !== id),
		},
	}));
}

/**
 * The provider with its last sync result dropped. Used when the endpoint,
 * key, request format, or model source changes: the stored result describes
 * a configuration that no longer exists.
 */
export function withoutSyncStatus(provider: AIProvider): AIProvider {
	const rest = { ...provider };
	delete rest.lastModelSync;
	return rest;
}

/**
 * Names for the providers' entries on the AI Assistant page. Obsidian finds a
 * settings sub-page by its name and requires sibling names to be unique, but
 * providers may share a name (two OpenAI accounts, or a rename). A shared or
 * blank name gets the provider's unique id appended.
 */
export function providerEntryNames(
	providers: ReadonlyArray<Pick<AIProvider, "id" | "name">>,
): string[] {
	const base = providers.map((p) => p.name.trim() || "Untitled provider");
	const counts = new Map<string, number>();
	for (const name of base) counts.set(name, (counts.get(name) ?? 0) + 1);

	const taken = new Set<string>();
	return base.map((name, index) => {
		let candidate =
			(counts.get(name) ?? 0) > 1 && providers[index].id
				? `${name} (${providers[index].id})`
				: name;
		// Only reachable with hand-edited ids or a name that already reads
		// like "Name (id)"; keep the entry reachable anyway.
		for (let n = 2; taken.has(candidate); n++) candidate = `${name} (${n})`;
		taken.add(candidate);
		return candidate;
	});
}
