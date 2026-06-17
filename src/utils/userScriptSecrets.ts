import type { App } from "obsidian";
import { log } from "../logger/logManager";
import type { IUserScript } from "../types/macros/IUserScript";
import { extractScriptFromMarkdown } from "./extractScriptFromMarkdown";

const USER_SCRIPT_SECRET_PREFIX = "quickadd-user-script";
const SECRET_MARKER = "__quickaddSecret";
const MARKDOWN_FILE_EXTENSION_REGEX = /\.md$/i;

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

export type UserScriptSecretSanitizerOptions = {
	/**
	 * Map a user-script path to the secret option names found in that script.
	 * `null` means the script declares at least one secret option but the setting
	 * name could not be statically recovered.
	 */
	secretOptionNamesByPath?: ReadonlyMap<string, ReadonlySet<string> | null>;
	stripUnknownStringSettings?: boolean;
};

export type UserScriptSecretOptionDetection = {
	names: Set<string>;
	foundSecretOptions: boolean;
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

function skipWhitespaceAndComments(source: string, index: number): number {
	let current = index;
	while (current < source.length) {
		const char = source[current];
		const next = source[current + 1];

		if (/\s/.test(char)) {
			current += 1;
			continue;
		}

		if (char === "/" && next === "/") {
			const newline = source.indexOf("\n", current + 2);
			current = newline === -1 ? source.length : newline + 1;
			continue;
		}

		if (char === "/" && next === "*") {
			const end = source.indexOf("*/", current + 2);
			current = end === -1 ? source.length : end + 2;
			continue;
		}

		return current;
	}

	return current;
}

function readStringLiteral(
	source: string,
	index: number,
): { value: string; end: number } | null {
	const quote = source[index];
	if (quote !== "\"" && quote !== "'" && quote !== "`") return null;

	let value = "";
	for (let current = index + 1; current < source.length; current++) {
		const char = source[current];

		if (char === "\\") {
			const escaped = source[current + 1];
			if (escaped === undefined) return null;
			value += escaped;
			current += 1;
			continue;
		}

		if (char === quote) {
			return { value, end: current + 1 };
		}

		value += char;
	}

	return null;
}

function readIdentifier(
	source: string,
	index: number,
): { value: string; end: number } | null {
	const match = /^[A-Za-z_$][\w$]*/.exec(source.slice(index));
	if (!match) return null;

	return {
		value: match[0],
		end: index + match[0].length,
	};
}

function findMatchingDelimiter(
	source: string,
	openIndex: number,
	open: "{" | "[",
	close: "}" | "]",
): number {
	let depth = 0;

	for (let current = openIndex; current < source.length; current++) {
		const char = source[current];
		const next = source[current + 1];

		if (char === "\"" || char === "'" || char === "`") {
			const literal = readStringLiteral(source, current);
			if (!literal) return -1;
			current = literal.end - 1;
			continue;
		}

		if (char === "/" && next === "/") {
			const newline = source.indexOf("\n", current + 2);
			current = newline === -1 ? source.length : newline;
			continue;
		}

		if (char === "/" && next === "*") {
			const end = source.indexOf("*/", current + 2);
			if (end === -1) return -1;
			current = end + 1;
			continue;
		}

		if (char === open) {
			depth += 1;
			continue;
		}

		if (char === close) {
			depth -= 1;
			if (depth === 0) return current;
		}
	}

	return -1;
}

function collectStringConstants(source: string): Map<string, string> {
	const constants = new Map<string, string>();
	const regex = /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(["'`])/g;
	let match: RegExpExecArray | null;

	while ((match = regex.exec(source)) !== null) {
		const literal = readStringLiteral(source, regex.lastIndex - 1);
		if (!literal) continue;
		constants.set(match[1], literal.value);
		regex.lastIndex = literal.end;
	}

	return constants;
}

function findOptionsObjectSpans(source: string): Array<{ start: number; end: number }> {
	const spans: Array<{ start: number; end: number }> = [];
	const constants = collectStringConstants(source);
	let current = 0;

	while (current < source.length) {
		current = skipWhitespaceAndComments(source, current);
		const char = source[current];
		const next = source[current + 1];

		if (char === "\"" || char === "'" || char === "`") {
			const literal = readStringLiteral(source, current);
			current = literal ? literal.end : current + 1;
			continue;
		}

		if (char === "/" && next === "/") {
			const newline = source.indexOf("\n", current + 2);
			current = newline === -1 ? source.length : newline + 1;
			continue;
		}

		if (char === "/" && next === "*") {
			const end = source.indexOf("*/", current + 2);
			current = end === -1 ? source.length : end + 2;
			continue;
		}

		const key = readOptionKey(source, current, constants);
		if (!key) {
			current += 1;
			continue;
		}

		current = skipWhitespaceAndComments(source, key.end);
		if (source[current] !== ":") {
			current = key.end;
			continue;
		}

		current = skipWhitespaceAndComments(source, current + 1);
		if (key.name !== "options") continue;
		if (source[current] !== "{") continue;

		const end = findMatchingDelimiter(source, current, "{", "}");
		if (end === -1) break;
		spans.push({ start: current + 1, end });
		current = end + 1;
	}

	return spans;
}

function readOptionKey(
	source: string,
	index: number,
	constants: ReadonlyMap<string, string>,
): { name: string | null; end: number } | null {
	if (source[index] === "\"" || source[index] === "'" || source[index] === "`") {
		const literal = readStringLiteral(source, index);
		if (!literal) return null;
		return { name: literal.value, end: literal.end };
	}

	if (source[index] === "[") {
		const current = skipWhitespaceAndComments(source, index + 1);
		const identifier = readIdentifier(source, current);
		const end = findMatchingDelimiter(source, index, "[", "]");
		if (end === -1) return null;
		const afterIdentifier = identifier
			? skipWhitespaceAndComments(source, identifier.end)
			: current;

		return {
			name:
				identifier && afterIdentifier === end
					? (constants.get(identifier.value) ?? null)
					: null,
			end: end + 1,
		};
	}

	const identifier = readIdentifier(source, index);
	if (!identifier) return null;

	return {
		name: identifier.value,
		end: identifier.end,
	};
}

function readTopLevelObjectProperties(source: string): Map<string, unknown> {
	const properties = new Map<string, unknown>();
	let current = 0;

	while (current < source.length) {
		current = skipWhitespaceAndComments(source, current);
		if (source[current] === ",") {
			current += 1;
			continue;
		}
		if (current >= source.length) break;

		const key = readOptionKey(source, current, new Map());
		if (!key?.name) {
			current += 1;
			continue;
		}

		current = skipWhitespaceAndComments(source, key.end);
		if (source[current] !== ":") {
			current += 1;
			continue;
		}

		current = skipWhitespaceAndComments(source, current + 1);
		if (
			source[current] === "\"" ||
			source[current] === "'" ||
			source[current] === "`"
		) {
			const literal = readStringLiteral(source, current);
			if (!literal) break;
			properties.set(key.name, literal.value);
			current = literal.end;
			continue;
		}

		if (source.slice(current, current + 4) === "true") {
			properties.set(key.name, true);
			current += 4;
			continue;
		}

		if (source.slice(current, current + 5) === "false") {
			properties.set(key.name, false);
			current += 5;
			continue;
		}

		if (source[current] === "{") {
			const end = findMatchingDelimiter(source, current, "{", "}");
			if (end === -1) break;
			current = end + 1;
			continue;
		}

		if (source[current] === "[") {
			const end = findMatchingDelimiter(source, current, "[", "]");
			if (end === -1) break;
			current = end + 1;
			continue;
		}

		while (current < source.length && source[current] !== ",") {
			current += 1;
		}
	}

	return properties;
}

function optionBodyDeclaresSecret(body: string): boolean {
	const properties = readTopLevelObjectProperties(body);
	const type = properties.get("type");
	const secret = properties.get("secret");

	return type === "secret" || ((type === "text" || type === "input") && secret === true);
}

export function detectUserScriptSecretOptions(
	source: string,
	path?: string,
): UserScriptSecretOptionDetection {
	const sourceToInspect =
		path && MARKDOWN_FILE_EXTENSION_REGEX.test(path)
			? (extractScriptFromMarkdown(source).code ?? "")
			: source;
	const names = new Set<string>();
	let foundSecretOptions = false;
	const constants = collectStringConstants(sourceToInspect);

	for (const { start, end } of findOptionsObjectSpans(sourceToInspect)) {
		let current = start;

		while (current < end) {
			current = skipWhitespaceAndComments(sourceToInspect, current);
			if (sourceToInspect[current] === ",") {
				current += 1;
				continue;
			}
			if (current >= end) break;

			const key = readOptionKey(sourceToInspect, current, constants);
			if (!key) {
				current += 1;
				continue;
			}

			current = skipWhitespaceAndComments(sourceToInspect, key.end);
			if (sourceToInspect[current] !== ":") {
				current += 1;
				continue;
			}

			current = skipWhitespaceAndComments(sourceToInspect, current + 1);
			if (sourceToInspect[current] !== "{") {
				current += 1;
				continue;
			}

			const valueEnd = findMatchingDelimiter(
				sourceToInspect,
				current,
				"{",
				"}",
			);
			if (valueEnd === -1 || valueEnd > end) break;

			const body = sourceToInspect.slice(current + 1, valueEnd);
			if (optionBodyDeclaresSecret(body)) {
				foundSecretOptions = true;
				if (key.name) names.add(key.name);
			}

			current = valueEnd + 1;
		}
	}

	return { names, foundSecretOptions };
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

async function clearSecretsFromChoice(
	app: App | undefined,
	choice: unknown,
): Promise<boolean> {
	if (!isRecord(choice)) return true;

	let cleared = true;

	if (choice.type === "Macro" && isRecord(choice.macro)) {
		cleared =
			(await clearUserScriptSecretsFromCommands(app, choice.macro.commands)) &&
			cleared;
	}

	if (choice.type === "Multi" && Array.isArray(choice.choices)) {
		for (const child of choice.choices) {
			cleared = (await clearSecretsFromChoice(app, child)) && cleared;
		}
	}

	return cleared;
}

export async function clearUserScriptSecretsFromCommand(
	app: App | undefined,
	command: unknown,
): Promise<boolean> {
	if (!isRecord(command)) return true;

	let cleared = true;

	if (command.type === "UserScript") {
		cleared = (await clearRefsFromSettings(app, command.settings)) && cleared;
	}

	if (Array.isArray(command.thenCommands)) {
		cleared =
			(await clearUserScriptSecretsFromCommands(app, command.thenCommands)) &&
			cleared;
	}
	if (Array.isArray(command.elseCommands)) {
		cleared =
			(await clearUserScriptSecretsFromCommands(app, command.elseCommands)) &&
			cleared;
	}

	cleared = (await clearSecretsFromChoice(app, command.choice)) && cleared;
	return cleared;
}

export async function clearUserScriptSecretsFromCommands(
	app: App | undefined,
	commands: unknown,
): Promise<boolean> {
	if (!Array.isArray(commands)) return true;

	let cleared = true;

	for (const command of commands) {
		cleared = (await clearUserScriptSecretsFromCommand(app, command)) && cleared;
	}

	return cleared;
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

export function stripUserScriptSecretRefsFromCommand(
	command: unknown,
	options?: UserScriptSecretSanitizerOptions,
): void {
	if (!isRecord(command)) return;

	if (command.type === "UserScript") {
		stripSecretRefsFromSettings(
			command.settings,
			getSecretOptionNamesForCommand(command, options),
			options,
		);
	}

	if (Array.isArray(command.thenCommands)) {
		stripUserScriptSecretRefsFromCommands(command.thenCommands, options);
	}
	if (Array.isArray(command.elseCommands)) {
		stripUserScriptSecretRefsFromCommands(command.elseCommands, options);
	}

	stripUserScriptSecretRefsFromChoice(command.choice, options);
}

export function stripUserScriptSecretRefsFromCommands(
	commands: unknown,
	options?: UserScriptSecretSanitizerOptions,
): void {
	if (!Array.isArray(commands)) return;

	for (const command of commands) {
		stripUserScriptSecretRefsFromCommand(command, options);
	}
}

export function stripUserScriptSecretRefsFromChoice(
	choice: unknown,
	options?: UserScriptSecretSanitizerOptions,
): void {
	if (!isRecord(choice)) return;

	if (choice.type === "Macro" && isRecord(choice.macro)) {
		stripUserScriptSecretRefsFromCommands(choice.macro.commands, options);
	}

	if (choice.type === "Multi" && Array.isArray(choice.choices)) {
		for (const child of choice.choices) {
			stripUserScriptSecretRefsFromChoice(child, options);
		}
	}
}
