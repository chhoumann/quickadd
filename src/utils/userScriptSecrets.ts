import type { App } from "obsidian";
import { log } from "../logger/logManager";
import type { IUserScript } from "../types/macros/IUserScript";

const USER_SCRIPT_SECRET_PREFIX = "quickadd-user-script";
const SECRET_MARKER = "__quickaddSecret";

type SecretStorageLike = {
	getSecret?: (id: string) => string | null | Promise<string | null>;
	setSecret?: (id: string, value: string) => void | Promise<void>;
	listSecrets?: () => string[] | Promise<string[]>;
	deleteSecret?: (id: string) => void | Promise<void>;
	removeSecret?: (id: string) => void | Promise<void>;
	delete?: (id: string) => void | Promise<void>;
};

export type UserScriptOptionDefinition = {
	type?: unknown;
	secret?: unknown;
	defaultValue?: unknown;
};

export type UserScriptSettingsDefinition = {
	options?: Record<string, UserScriptOptionDefinition>;
};

export type UserScriptSecretRef = {
	[SECRET_MARKER]: true;
	secretRef: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === "object";
}

function getSecretStorage(app: App | undefined): SecretStorageLike | undefined {
	return app?.secretStorage as SecretStorageLike | undefined;
}

function normalizeSecretIdPart(value: string): string {
	const normalized = value
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "");

	return normalized || "setting";
}

function formatSecretError(error: unknown): string {
	return (error as Error)?.message ?? String(error);
}

export function isSecretUserScriptOption(option: unknown): boolean {
	if (!isRecord(option)) return false;

	if (option.type === "secret") return true;
	if (
		(option.type === "text" || option.type === "input") &&
		option.secret === true
	) {
		return true;
	}

	return false;
}

export function isUserScriptSecretRef(
	value: unknown,
): value is UserScriptSecretRef {
	return (
		isRecord(value) &&
		value[SECRET_MARKER] === true &&
		typeof value.secretRef === "string" &&
		value.secretRef.trim().length > 0
	);
}

export function createUserScriptSecretRef(secretRef: string): UserScriptSecretRef {
	return {
		[SECRET_MARKER]: true,
		secretRef,
	};
}

export function buildUserScriptSecretId(
	command: IUserScript,
	settingName: string,
): string {
	const commandId = command.id?.trim() || command.path || command.name || "script";
	return [
		USER_SCRIPT_SECRET_PREFIX,
		normalizeSecretIdPart(commandId),
		normalizeSecretIdPart(settingName),
	].join("-");
}

export function getSecretOptionNames(
	userScriptSettings: UserScriptSettingsDefinition | undefined,
): string[] {
	const options = userScriptSettings?.options;
	if (!options) return [];

	return Object.entries(options)
		.filter(([, option]) => isSecretUserScriptOption(option))
		.map(([name]) => name);
}

async function readSecretStorageEntry(
	app: App | undefined,
	secretRef: string,
): Promise<string | null> {
	const secretStorage = getSecretStorage(app);
	if (!secretStorage?.getSecret) return null;

	try {
		return await Promise.resolve(secretStorage.getSecret(secretRef));
	} catch (error) {
		log.logWarning(
			`Failed to read user script SecretStorage entry "${secretRef}": ${formatSecretError(error)}`,
		);
		return null;
	}
}

async function writeSecretStorageEntry(
	app: App | undefined,
	secretRef: string,
	value: string,
): Promise<boolean> {
	const secretStorage = getSecretStorage(app);
	if (!secretStorage?.setSecret) return false;

	try {
		await Promise.resolve(secretStorage.setSecret(secretRef, value));
		return true;
	} catch (error) {
		log.logWarning(
			`Failed to write user script SecretStorage entry "${secretRef}": ${formatSecretError(error)}`,
		);
		return false;
	}
}

async function buildAvailableSecretRef(
	app: App | undefined,
	command: IUserScript,
	settingName: string,
	value: string,
): Promise<string> {
	const base = buildUserScriptSecretId(command, settingName);
	let candidate = base;
	let suffix = 1;

	while (true) {
		const existing = await readSecretStorageEntry(app, candidate);
		if (!existing || existing === value) return candidate;

		suffix += 1;
		candidate = `${base}-${suffix}`;
	}
}

export async function storeUserScriptSecret(
	app: App | undefined,
	command: IUserScript,
	settingName: string,
	value: string,
	existingRef?: string,
): Promise<string | null> {
	if (value.length === 0) return null;

	const secretRef =
		existingRef?.trim() ||
		(await buildAvailableSecretRef(app, command, settingName, value));
	const stored = await writeSecretStorageEntry(app, secretRef, value);

	return stored ? secretRef : null;
}

export async function clearUserScriptSecret(
	app: App | undefined,
	secretRef: string | undefined,
): Promise<boolean> {
	const trimmedRef = secretRef?.trim();
	if (!trimmedRef) return true;

	const secretStorage = getSecretStorage(app);
	if (!secretStorage) return false;

	const deleteMethod =
		secretStorage.deleteSecret ??
		secretStorage.removeSecret ??
		secretStorage.delete;

	try {
		if (deleteMethod) {
			await Promise.resolve(deleteMethod.call(secretStorage, trimmedRef));
			return true;
		}

		if (secretStorage.setSecret) {
			await Promise.resolve(secretStorage.setSecret(trimmedRef, ""));
			return true;
		}
	} catch (error) {
		log.logWarning(
			`Failed to clear user script SecretStorage entry "${trimmedRef}": ${formatSecretError(error)}`,
		);
	}

	return false;
}

export async function resolveUserScriptSettings(
	app: App | undefined,
	command: IUserScript,
	userScriptSettings: UserScriptSettingsDefinition | undefined,
): Promise<Record<string, unknown>> {
	const commandSettings = command.settings ?? {};
	const resolvedSettings = { ...commandSettings };
	const secretOptionNames = new Set(getSecretOptionNames(userScriptSettings));

	for (const [name, value] of Object.entries(commandSettings)) {
		if (isUserScriptSecretRef(value)) {
			const secret = await readSecretStorageEntry(app, value.secretRef);
			if (secret) {
				resolvedSettings[name] = secret;
				continue;
			}

			throw new Error(
				`Secret setting "${name}" for user script "${command.name}" is unavailable. Re-enter it on this device.`,
			);
		}

		if (secretOptionNames.has(name)) {
			resolvedSettings[name] = typeof value === "string" ? value : "";
		}
	}

	for (const name of secretOptionNames) {
		if (!(name in resolvedSettings)) {
			resolvedSettings[name] = "";
		}
	}

	return resolvedSettings;
}

export async function migrateUserScriptSecretSettings(
	app: App | undefined,
	command: IUserScript,
	userScriptSettings: UserScriptSettingsDefinition | undefined,
): Promise<boolean> {
	const secretOptionNames = getSecretOptionNames(userScriptSettings);
	if (secretOptionNames.length === 0) return false;

	const secretStorage = getSecretStorage(app);
	if (!secretStorage?.getSecret || !secretStorage?.setSecret) {
		const hasLegacySecrets = secretOptionNames.some((name) => {
			const value = command.settings?.[name];
			return typeof value === "string" && value.length > 0;
		});

		if (hasLegacySecrets) {
			log.logWarning(
				`SecretStorage unavailable; leaving plaintext user script secret settings for "${command.name}" unchanged.`,
			);
		}

		return false;
	}

	let migrated = false;

	for (const settingName of secretOptionNames) {
		const value = command.settings?.[settingName];
		if (isUserScriptSecretRef(value)) continue;
		if (typeof value !== "string" || value.length === 0) continue;

		const secretRef = await storeUserScriptSecret(
			app,
			command,
			settingName,
			value,
		);
		if (!secretRef) continue;

		command.settings[settingName] = createUserScriptSecretRef(secretRef);
		migrated = true;
	}

	return migrated;
}

export function getSecretRefFromCommandSetting(
	command: IUserScript,
	settingName: string,
): string | undefined {
	const value = command.settings?.[settingName];
	return isUserScriptSecretRef(value) ? value.secretRef : undefined;
}
