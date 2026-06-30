import type QuickAdd from "src/main";
import { log } from "src/logger/logManager";
import { settingsStore } from "src/settingsStore";
import { deepClone } from "src/utils/deepClone";
import type { Migration } from "./Migrations";
import { storeProviderApiKeyInSecretStorage } from "src/ai/providerSecrets";

const migrateProviderApiKeysToSecretStorage: Migration = {
	description: "Move AI provider API keys into Obsidian SecretStorage",
	migrate: async (plugin: QuickAdd) => {
		const providers = settingsStore.getState().ai.providers ?? [];
		// The migration's single invariant: it is complete iff no provider
		// still holds a plaintext apiKey. SecretStorage availability only
		// decides whether we can act to reach that state, not whether we are
		// done.
		const hasPlaintextKey = () =>
			providers.some(
				(provider) => (provider.apiKey?.trim() ?? "") !== "",
			);

		const secretStorage = plugin.app?.secretStorage;
		if (!secretStorage?.getSecret || !secretStorage?.setSecret) {
			// SecretStorage does not exist on this build (old Obsidian / mobile),
			// so we cannot move keys now. Stay pending only while a plaintext key
			// is actually waiting, so it migrates once SecretStorage becomes
			// available instead of being stranded in plaintext forever. With
			// nothing to migrate the invariant already holds, so complete.
			if (!hasPlaintextKey()) return;
			log.logWarning(
				"SecretStorage unavailable; deferring AI provider API key migration until it is available.",
			);
			return { complete: false };
		}

		let updated = false;

		for (const provider of providers) {
			const legacyKey = provider.apiKey?.trim();
			const secretName = provider.apiKeyRef?.trim();

			if (secretName) {
				try {
					const existing = await Promise.resolve(
						secretStorage.getSecret(secretName),
					);
					if (!existing && legacyKey) {
						await Promise.resolve(
							secretStorage.setSecret(secretName, legacyKey),
						);
						provider.apiKey = "";
						updated = true;
					} else if (existing && legacyKey) {
						provider.apiKey = "";
						updated = true;
					}
				} catch (err) {
					log.logWarning(
						`Failed to migrate secret for ${provider.name}: ${(err as Error).message ?? err}`,
					);
				}
				continue;
			}

			if (!legacyKey) continue;

			try {
				const storedName = await storeProviderApiKeyInSecretStorage(
					plugin.app,
					provider,
					legacyKey,
				);
				if (storedName) {
					provider.apiKeyRef = storedName;
					provider.apiKey = "";
					updated = true;
				}
			} catch (err) {
				log.logWarning(
					`Failed to store API key for ${provider.name}: ${(err as Error).message ?? err}`,
				);
			}
		}

		if (updated) {
			settingsStore.setState((state) => ({
				...state,
				ai: {
					...state.ai,
					providers: deepClone(providers),
				},
			}));
		}

		// If any key is still present, a move failed (write error, read error,
		// helper returned null) - stay pending so it is retried on a later
		// launch instead of being silently marked complete.
		if (hasPlaintextKey()) {
			return { complete: false };
		}
	},
};

export default migrateProviderApiKeysToSecretStorage;
