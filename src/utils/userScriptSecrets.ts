import type { App } from "obsidian";
import { log } from "../logger/logManager";
import type { IUserScript } from "../types/macros/IUserScript";
export { detectUserScriptSecretOptions, type UserScriptSecretOptionDetection } from "./userScriptSecretDetection";
import { macroCommandsValueOf } from "./macroUtils";

const USER_SCRIPT_SECRET_PREFIX = "quickadd-user-script";
const SECRET_MARKER = "__quickaddSecret";
const MAX_SECRET_ID_LENGTH = 64;
const SECRET_ID_HASH_LENGTH = 8;

type SecretStorageLike = {
	getSecret?: (id: string) => string | null | Promise<string | null>;
	setSecret?: (id: string, value: string) => void | Promise<void>;
	listSecrets?: () => string[] | Promise<string[]>;
	deleteSecret?: (id: string) => void | Promise<void>;
	removeSecret?: (id: string) => void | Promise<void>;
	delete?: (id: string) => void | Promise<void>;
};

export type UserScriptOptionDefinition = {
	id?: unknown;
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

export type UserScriptSecretSanitizerOptions = {
	/**
	 * Map a user-script path to the secret option names found in that script.
	 * `null` means the script declares at least one secret option but the setting
	 * name could not be statically recovered.
	 */
	secretOptionNamesByPath?: ReadonlyMap<string, ReadonlySet<string> | null>;
	stripUnknownStringSettings?: boolean;
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

function hashSecretId(value: string): string {
	let hash = 5381;
	for (let index = 0; index < value.length; index += 1) {
		hash = (hash * 33) ^ value.charCodeAt(index);
	}

	return (hash >>> 0).toString(36).slice(0, SECRET_ID_HASH_LENGTH);
}

function truncateSecretIdPart(value: string, maxLength: number): string {
	if (value.length <= maxLength) return value;
	return value.slice(0, maxLength).replace(/-+$/g, "") || "setting";
}

function getSecretSettingId(
	settingName: string,
	option?: UserScriptOptionDefinition,
): string {
	const optionId = option?.id;
	if (typeof optionId === "string" && optionId.trim().length > 0) {
		return optionId;
	}

	return settingName;
}

function fitSecretId(
	commandPart: string,
	settingPart: string,
	suffixPart?: string,
): string {
	const rawParts = suffixPart
		? [USER_SCRIPT_SECRET_PREFIX, commandPart, settingPart, suffixPart]
		: [USER_SCRIPT_SECRET_PREFIX, commandPart, settingPart];
	const raw = rawParts.join("-");
	if (raw.length <= MAX_SECRET_ID_LENGTH) return raw;

	const hash = hashSecretId(
		[commandPart, settingPart, suffixPart].filter(Boolean).join(":"),
	);
	const separatorBudget = suffixPart ? 4 : 3;
	const partBudget =
		MAX_SECRET_ID_LENGTH -
		USER_SCRIPT_SECRET_PREFIX.length -
		hash.length -
		(suffixPart?.length ?? 0) -
		separatorBudget;
	const commandBudget = Math.max(8, Math.floor(partBudget * 0.6));
	const settingBudget = Math.max(8, partBudget - commandBudget);

	return [
		USER_SCRIPT_SECRET_PREFIX,
		truncateSecretIdPart(commandPart, commandBudget),
		truncateSecretIdPart(settingPart, settingBudget),
		...(suffixPart ? [suffixPart] : []),
		hash,
	].join("-");
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
	option?: UserScriptOptionDefinition,
): string {
	const commandId = command.id?.trim() || command.path || command.name || "script";
	return fitSecretId(
		normalizeSecretIdPart(commandId),
		normalizeSecretIdPart(getSecretSettingId(settingName, option)),
	);
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

function getSecretOptionEntries(
	userScriptSettings: UserScriptSettingsDefinition | undefined,
): Array<[string, UserScriptOptionDefinition]> {
	const options = userScriptSettings?.options;
	if (!options) return [];

	return Object.entries(options).filter(([, option]) =>
		isSecretUserScriptOption(option),
	);
}

function optionDefinesStableSecretId(option: UserScriptOptionDefinition): boolean {
	return typeof option.id === "string" && option.id.trim().length > 0;
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
	option?: UserScriptOptionDefinition,
): Promise<string> {
	const commandId = command.id?.trim() || command.path || command.name || "script";
	const commandPart = normalizeSecretIdPart(commandId);
	const settingPart = normalizeSecretIdPart(getSecretSettingId(settingName, option));
	let candidate = fitSecretId(commandPart, settingPart);
	let suffix = 1;

	while (true) {
		const existing = await readSecretStorageEntry(app, candidate);
		if (!existing || existing === value) return candidate;

		suffix += 1;
		candidate = fitSecretId(commandPart, settingPart, String(suffix));
	}
}

export async function storeUserScriptSecret(
	app: App | undefined,
	command: IUserScript,
	settingName: string,
	value: string,
	existingRef?: string,
	option?: UserScriptOptionDefinition,
): Promise<string | null> {
	if (value.length === 0) return null;

	const secretRef =
		existingRef?.trim() ||
		(await buildAvailableSecretRef(app, command, settingName, value, option));
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
	if (!secretStorage) return true;

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

	return resolvedSettings;
}

export async function migrateUserScriptSecretSettings(
	app: App | undefined,
	command: IUserScript,
	userScriptSettings: UserScriptSettingsDefinition | undefined,
): Promise<boolean> {
	const secretOptionEntries = getSecretOptionEntries(userScriptSettings);
	if (secretOptionEntries.length === 0) return false;

	const secretStorage = getSecretStorage(app);
	if (!secretStorage?.getSecret || !secretStorage?.setSecret) {
		const hasLegacySecrets = secretOptionEntries.some(([name]) => {
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

	for (const [settingName, option] of secretOptionEntries) {
		const value = command.settings?.[settingName];
		if (isUserScriptSecretRef(value)) continue;
		if (typeof value !== "string" || value.length === 0) {
			if (!optionDefinesStableSecretId(option)) continue;

			const secretRef = buildUserScriptSecretId(command, settingName, option);
			const existingSecret = await readSecretStorageEntry(app, secretRef);
			if (!existingSecret) continue;

			command.settings[settingName] = createUserScriptSecretRef(secretRef);
			for (const [existingName, existingValue] of Object.entries(
				command.settings,
			)) {
				if (
					existingName !== settingName &&
					isUserScriptSecretRef(existingValue) &&
					existingValue.secretRef === secretRef
				) {
					delete command.settings[existingName];
				}
			}
			migrated = true;
			continue;
		}

		const secretRef = await storeUserScriptSecret(
			app,
			command,
			settingName,
			value,
			undefined,
			option,
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

async function clearRefsFromSettings(
	app: App | undefined,
	settings: unknown,
): Promise<boolean> {
	if (!isRecord(settings)) return true;

	const secretRefs = Object.values(settings)
		.filter(isUserScriptSecretRef)
		.map((value) => value.secretRef);

	const results = await Promise.all(
		secretRefs.map((secretRef) => clearUserScriptSecret(app, secretRef)),
	);
	return results.every(Boolean);
}

function* userScriptsInChoice(choice: unknown): Generator<Record<string, unknown>> {
	if (!isRecord(choice)) return;
	if (choice.type === "Macro") {
		yield* userScriptsInCommands(macroCommandsValueOf(choice.macro));
	}
	if (choice.type === "Multi" && Array.isArray(choice.choices)) {
		for (const child of choice.choices) yield* userScriptsInChoice(child);
	}
}

function* userScriptsInCommand(command: unknown): Generator<Record<string, unknown>> {
	if (!isRecord(command)) return;
	if (command.type === "UserScript") yield command;
	yield* userScriptsInCommands(command.thenCommands);
	yield* userScriptsInCommands(command.elseCommands);
	yield* userScriptsInChoice(command.choice);
}

function* userScriptsInCommands(commands: unknown): Generator<Record<string, unknown>> {
	if (!Array.isArray(commands)) return;
	for (const command of commands) {
		// Nested arrays carry command lists, including legacy array-valued macros.
		yield* Array.isArray(command)
			? userScriptsInCommands(command)
			: userScriptsInCommand(command);
	}
}

async function clearScriptSecrets(
	app: App | undefined,
	commands: Iterable<Record<string, unknown>>,
): Promise<boolean> {
	let cleared = true;
	for (const command of commands) {
		cleared = (await clearRefsFromSettings(app, command.settings)) && cleared;
	}
	return cleared;
}

export async function clearUserScriptSecretsFromCommand(
	app: App | undefined,
	command: unknown,
): Promise<boolean> {
	return clearScriptSecrets(app, userScriptsInCommand(command));
}

export async function clearUserScriptSecretsFromCommands(
	app: App | undefined,
	commands: unknown,
): Promise<boolean> {
	return clearScriptSecrets(app, userScriptsInCommands(commands));
}

function getSecretOptionNamesForCommand(
	command: Record<string, unknown>,
	options?: UserScriptSecretSanitizerOptions,
): ReadonlySet<string> | null | undefined {
	const path = command.path;
	if (typeof path !== "string") return undefined;

	return options?.secretOptionNamesByPath?.get(path);
}

function stripSecretRefsFromSettings(
	settings: unknown,
	secretOptionNames: ReadonlySet<string> | null | undefined,
	options?: UserScriptSecretSanitizerOptions,
): void {
	if (!isRecord(settings)) return;

	for (const [name, value] of Object.entries(settings)) {
		if (isUserScriptSecretRef(value)) {
			delete settings[name];
			continue;
		}

		if (
			typeof value === "string" &&
			(secretOptionNames === null ||
				secretOptionNames?.has(name) ||
				(secretOptionNames === undefined &&
					options?.stripUnknownStringSettings === true))
		) {
			delete settings[name];
		}
	}
}

function stripScriptSecrets(
	commands: Iterable<Record<string, unknown>>,
	options?: UserScriptSecretSanitizerOptions,
): void {
	for (const command of commands) {
		stripSecretRefsFromSettings(
			command.settings,
			getSecretOptionNamesForCommand(command, options),
			options,
		);
	}
}

export function stripUserScriptSecretRefsFromCommand(
	command: unknown,
	options?: UserScriptSecretSanitizerOptions,
): void {
	stripScriptSecrets(userScriptsInCommand(command), options);
}

export function stripUserScriptSecretRefsFromCommands(
	commands: unknown,
	options?: UserScriptSecretSanitizerOptions,
): void {
	stripScriptSecrets(userScriptsInCommands(commands), options);
}

export function stripUserScriptSecretRefsFromChoice(
	choice: unknown,
	options?: UserScriptSecretSanitizerOptions,
): void {
	stripScriptSecrets(userScriptsInChoice(choice), options);
}
