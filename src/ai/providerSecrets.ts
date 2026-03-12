import type { App } from "obsidian";
import { log } from "src/logger/logManager";
import type { AIProvider } from "./Provider";

const SECRET_PREFIX = "quickadd-ai";

function toSecretId(value: string): string {
	const normalized = value
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "");
	return normalized || "provider";
}

function buildSecretBase(provider: AIProvider): string {
	const name = provider.name?.trim() || "provider";
	return `${SECRET_PREFIX}-${toSecretId(name)}`;
}

async function readSecretStorageEntry(
	app: App | undefined,
	secretName: string,
): Promise<string | null> {
	if (!app?.secretStorage?.getSecret) return null;

	try {
		return await Promise.resolve(app.secretStorage.getSecret(secretName));
	} catch (err) {
		log.logWarning(
			`Failed to read SecretStorage entry "${secretName}": ${(err as Error).message ?? err}`,
		);
		return null;
	}
}

export async function resolveProviderApiKey(
	app: App | undefined,
	provider: AIProvider,
): Promise<string> {
	const secretName = provider.apiKeyRef?.trim();
	if (secretName) {
		const secret = await readSecretStorageEntry(app, secretName);
		if (secret) return secret;
	}

	return provider.apiKey ?? "";
}

export async function storeProviderApiKeyInSecretStorage(
	app: App | undefined,
	provider: AIProvider,
	apiKey: string,
): Promise<string | null> {
	const trimmed = apiKey?.trim();
	if (!trimmed) return null;
	if (!app?.secretStorage?.getSecret || !app.secretStorage?.setSecret) return null;

	const base = buildSecretBase(provider);
	let candidate = base;
	let suffix = 1;

	while (true) {
		const existing = await readSecretStorageEntry(app, candidate);

		if (!existing) break;
		if (existing === trimmed) return candidate;

		suffix += 1;
		candidate = `${base}-${suffix}`;
	}

	try {
		await Promise.resolve(app.secretStorage.setSecret(candidate, trimmed));
		return candidate;
	} catch (err) {
		log.logWarning(
			`Failed to write SecretStorage entry "${candidate}": ${(err as Error).message ?? err}`,
		);
		return null;
	}
}
