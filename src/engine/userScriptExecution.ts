import type { App } from "obsidian";
import type * as obsidian from "obsidian";
import type { QuickAddApi } from "../quickAddApi";
import type QuickAdd from "../main";
import type { IChoiceExecutor } from "../IChoiceExecutor";
import type { IUserScript } from "../types/macros/IUserScript";
import { getUserScript } from "../utilityObsidian";
import { getUserScriptPreloadKey } from "../utils/userScript";
import { initializeUserScriptSettings } from "../utils/userScriptSettings";
import { resolveScriptSettings } from "./userScriptSettings";
import { log } from "../logger/logManager";
import { reportError, isCancellationError } from "../utils/errorUtils";
import { MacroAbortError } from "../errors/MacroAbortError";
import { ChoiceAbortError } from "../errors/ChoiceAbortError";
import { UserCancelError } from "../errors/UserCancelError";
import GenericSuggester from "../gui/GenericSuggester/genericSuggester";
import { routePrompt } from "../interactive/routePrompt";
import { promptEngineChoice } from "../interactive/engineChoice";

export type ScriptParameters = {
	app: App;
	quickAddApi: QuickAddApi;
	variables: Record<string, unknown>;
	obsidian: typeof obsidian;
	abort: (message?: string) => never;
};

type ScriptContext = {
	app: App;
	plugin: QuickAdd;
	choiceName: string;
	params: ScriptParameters;
	executor: IChoiceExecutor;
	preloadedUserScripts: Map<string, unknown>;
	promptLabel?: string;
};

type ScriptResult = { output: unknown };
type UserScriptFunction = (params: ScriptParameters, settings: Record<string, unknown>) => unknown;

function isRecord(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === "object";
}

function isUserScriptFunction(value: unknown): value is UserScriptFunction {
	return typeof value === "function";
}

export async function executeUserScript(
	command: IUserScript,
	context: ScriptContext,
): Promise<ScriptResult | undefined> {
	const { app, plugin, choiceName, params, executor, preloadedUserScripts, promptLabel } = context;
	// Preloaded exports are member-specific and consumed once.
	const cacheKey = getUserScriptPreloadKey(command);
	let userScript = cacheKey === undefined ? undefined : preloadedUserScripts.get(cacheKey);
	if (cacheKey !== undefined && userScript !== undefined) preloadedUserScripts.delete(cacheKey);
	if (userScript === undefined) userScript = await getUserScript(command, app);
	if (!userScript) {
		log.logError(`failed to load user script ${command.path}.`);
		return;
	}

	if (!command.settings) command.settings = {};
	const settingsExport = isRecord(userScript) ? userScript.settings : undefined;
	const definition = isRecord(settingsExport) ? settingsExport : undefined;
	if (definition) initializeUserScriptSettings(command.settings, definition);

	async function invoke(fn: UserScriptFunction): Promise<ScriptResult> {
		const settings = await resolveScriptSettings(app, plugin, command, definition);
		return { output: await fn(params, settings) };
	}

	async function delegate(value: unknown): Promise<ScriptResult | undefined> {
		if (isUserScriptFunction(value)) return invoke(value);
		if (isRecord(value)) {
			if (Object.keys(value).length === 0) {
				throw new Error(`user script in macro for '${choiceName}' is an empty object`);
			}
			if (isUserScriptFunction(value.entry)) return invoke(value.entry);
			const keys = Object.keys(value);
			try {
				const selected = String(await routePrompt(executor, {
					remote: (provider) => promptEngineChoice(provider, {
						items: keys.map((key) => ({ value: key, title: key })),
						placeholder: promptLabel,
						what: "the user-script member picker",
					}),
					headless: () => {
						if (keys.length === 1) return Promise.resolve(keys[0]);
						throw new ChoiceAbortError(
							"This macro's user script exports multiple members and needs to ask which one to run, but this run is non-interactive. " +
								"Reference a single member (e.g. myScript::start), or re-run with the ui flag.",
						);
					},
					app: () => GenericSuggester.Suggest(app, keys, keys, promptLabel),
				}));
				// Routed replies may only select own exports, never inherited members.
				if (!Object.hasOwn(value, selected)) {
					throw new Error(`This macro's user script does not export a member named "${selected}".`);
				}
				return await delegate(value[selected]);
			} catch (err) {
				if (err instanceof MacroAbortError) throw err;
				if (isCancellationError(err)) throw new UserCancelError("Input cancelled by user");
				throw err;
			}
		}
		switch (typeof value) {
			case "bigint":
			case "boolean":
			case "number":
			case "string":
				return { output: value.toString() };
			case "object":
				return;
			default:
				log.logError(`user script in macro for '${choiceName}' is invalid`);
		}
	}

	try {
		return await delegate(userScript);
	} catch (err) {
		if (err instanceof MacroAbortError) throw err;
		reportError(err, `Failed to run user script ${command.name} in "${choiceName}"`);
		throw err;
	}
}
