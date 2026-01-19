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
			log.logWarning(
				"SecretStorage unavailable; skipping AI provider API key migration.",
			);
			return;
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

		if (!updated) return;

		settingsStore.setState((state) => ({
			...state,
			ai: {
				...state.ai,
				providers: deepClone(providers),
			},
		}));
	},
};

export default migrateProviderApiKeysToSecretStorage;
