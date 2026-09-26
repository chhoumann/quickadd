import type { CliData, CliFlags } from "obsidian";
import { testProviderConnection } from "../ai/providerConnection";
import type QuickAdd from "../main";
import { settingsStore } from "../settingsStore";

export const AI_TEST_CONNECTION_COMMAND = "quickadd:ai-test-connection";

export const AI_TEST_CONNECTION_FLAGS: CliFlags = {
	provider: { value: "<id|name>", description: "AI provider id (e.g. openai) or name" },
};

/**
 * CLI seam for the provider settings' Test connection button: asks the
 * provider's models endpoint with the linked key. The result never contains
 * the key, only whether one is linked.
 */
export async function aiTestConnectionHandler(
	plugin: QuickAdd,
	params: CliData,
): Promise<{ ok: boolean; [key: string]: unknown }> {
	const selector = String(params.provider ?? "").trim();
	const providers = settingsStore.getState().ai.providers;
	if (!selector) {
		return {
			ok: false,
			error: "Pass provider=<id|name>.",
			providers: providers.map((p) => p.id ?? p.name),
		};
	}
	const lowered = selector.toLowerCase();
	const provider =
		providers.find((p) => p.id === selector) ??
		providers.find((p) => p.name.trim().toLowerCase() === lowered);
	if (!provider) {
		return {
			ok: false,
			error: `No AI provider matches "${selector}".`,
			providers: providers.map((p) => p.id ?? p.name),
		};
	}

	const result = await testProviderConnection(plugin.app, provider);
	return { provider: provider.id ?? provider.name, ...result };
}
