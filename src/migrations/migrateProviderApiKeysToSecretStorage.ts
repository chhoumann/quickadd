import type QuickAdd from "src/main";
import { log } from "src/logger/logManager";
import { settingsStore } from "src/settingsStore";
import { deepClone } from "src/utils/deepClone";
import type { Migration } from "./Migrations";
import { storeProviderApiKeyInSecretStorage } from "src/ai/providerSecrets";

const migrateProviderApiKeysToSecretStorage: Migration = {
	description: "Move AI provider API keys into Obsidian SecretStorage",
	migrate: async (plugin: QuickAdd) => {
		const secretStorage = plugin.app?.secretStorage;
		if (!secretStorage?.getSecret || !secretStorage?.setSecret) {
			// SecretStorage does not exist on this build (old Obsidian / mobile).
			// Stay pending so the keys are migrated once it becomes available,
			// rather than marking the migration done and leaving them in
			// plaintext forever.
			log.logWarning(
				"SecretStorage unavailable; deferring AI provider API key migration until it is available.",
			);
			return { complete: false };
		}

		const currentSettings = settingsStore.getState();
		const providers = currentSettings.ai.providers ?? [];
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

		// The migration's goal is that no provider keeps a plaintext apiKey.
		// If any key is still present, a move failed (write error, read error,
		// helper returned null) - stay pending so it is retried on a later
		// launch instead of being silently marked complete.
		const hasRemainingPlaintextKey = providers.some(
			(provider) => (provider.apiKey?.trim() ?? "") !== "",
		);
		if (hasRemainingPlaintextKey) {
			return { complete: false };
		}
	},
};

export default migrateProviderApiKeysToSecretStorage;
