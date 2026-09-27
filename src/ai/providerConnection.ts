import type { App } from "obsidian";
import { discoverProviderModels } from "./modelDiscoveryService";
import type { AIProvider } from "./Provider";
import { resolveProviderApiKey } from "./providerSecrets";

export type ProviderConnectionResult =
	| { ok: true; modelCount: number; apiKeyLinked: boolean }
	| { ok: false; error: string; apiKeyLinked: boolean };

/**
 * Ask the provider's own models endpoint, with the linked key, whether it
 * answers. Always uses the provider API even for a models.dev-sourced
 * provider: the directory answers without a key, so it can't vouch for one.
 * Never includes the key in the result.
 */
export async function testProviderConnection(
	app: App | undefined,
	provider: AIProvider,
): Promise<ProviderConnectionResult> {
	let apiKey = "";
	try {
		apiKey = await resolveProviderApiKey(app, provider);
		const models = await discoverProviderModels(
			{ ...provider, modelSource: "providerApi" },
			apiKey,
		);
		return { ok: true, modelCount: models.length, apiKeyLinked: !!apiKey };
	} catch (err) {
		return {
			ok: false,
			error: (err as Error)?.message || String(err) || "Unknown error",
			apiKeyLinked: !!apiKey,
		};
	}
}

/** The one-line result shown under the provider's Connection setting. */
export function describeConnectionResult(result: ProviderConnectionResult): string {
	if (result.ok) {
		const models = `${result.modelCount} model${result.modelCount === 1 ? "" : "s"}`;
		return `✓ Connected. The provider lists ${models}.`;
	}
	return `✗ ${result.error}${result.apiKeyLinked ? "" : " (No API key is linked.)"}`;
}
