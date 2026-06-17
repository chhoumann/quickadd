import type QuickAdd from "src/main";
import { settingsStore } from "src/settingsStore";
import type { Migration } from "./Migrations";
import { deepClone } from "src/utils/deepClone";
import { getProviderKind } from "src/ai/Provider";

/**
 * Backfill the `kind` wire-protocol discriminator on every AI provider (#714). The
 * tool-calling / structured-output adapter selects on `kind`, not the display name,
 * so a custom Anthropic-compatible provider named anything other than "Anthropic"
 * routes correctly. Inference (getProviderKind) covers providers without the field
 * at runtime; this migration persists the inferred value once.
 */
const setProviderKind: Migration = {
	description: "Backfill the wire-protocol kind on each AI provider",
	migrate: async (_plugin: QuickAdd) => {
		const currentSettings = settingsStore.getState();
		const providers = currentSettings.ai.providers ?? [];
		let updated = false;

		for (const provider of providers) {
			if (!provider.kind) {
				provider.kind = getProviderKind(provider);
				updated = true;
			}
		}

		if (!updated) return;

		settingsStore.setState((state) => ({
			...state,
			ai: { ...state.ai, providers: deepClone(providers) },
		}));
	},
};

export default setProviderKind;
