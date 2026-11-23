import type { App } from "obsidian";
import { log } from "../logger/logManager";

/**
 * Reads one entry from Obsidian's SecretStorage. Null when the entry is
 * missing, when this Obsidian has no SecretStorage, or when reading fails; a
 * failure is logged as a warning naming `description`.
 */
export async function readSecretStorageEntry(
	app: App | undefined,
	name: string,
	description = "SecretStorage entry",
): Promise<string | null> {
	const secretStorage = app?.secretStorage;
	if (!secretStorage?.getSecret) return null;

	try {
		return await Promise.resolve(secretStorage.getSecret(name));
	} catch (error) {
		log.logWarning(
			`Failed to read ${description} "${name}": ${(error as Error)?.message ?? String(error)}`,
		);
		return null;
	}
}
