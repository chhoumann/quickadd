import type { App } from "obsidian";
import type * as obsidian from "obsidian";
import type { QuickAddApi } from "../quickAddApi";
import type IMacroChoice from "../types/choices/IMacroChoice";
import type QuickAdd from "../main";
import type { IChoiceExecutor } from "../IChoiceExecutor";
import type { IUserScript } from "../types/macros/IUserScript";
import type { UserScriptSettingsDefinition } from "../utils/userScriptSecrets";
import { QuickAddChoiceEngine } from "./QuickAddChoiceEngine";
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

type UserScriptFunction = (
	params: ScriptParameters,
	settings: Record<string, unknown>
) => Promise<unknown>;

type UserScriptObjectExport = Record<string, unknown> & {
	entry?: UserScriptFunction;
	settings?: Record<string, unknown>;
};
function isRecord(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === "object";
}

function isUserScriptFunction(value: unknown): value is UserScriptFunction {
	return typeof value === "function";
}

function isUserScriptObjectExport(
	value: unknown
): value is UserScriptObjectExport {
	return isRecord(value);
}

function getUserScriptSettings(
	value: unknown
): Record<string, unknown> | undefined {
	if (!isUserScriptObjectExport(value)) return undefined;
	const { settings } = value;
	return isRecord(settings) ? settings : undefined;
}

export abstract class UserScriptEngine extends QuickAddChoiceEngine {
	public abstract choice: IMacroChoice;
	public abstract params: ScriptParameters;
	protected abstract output: unknown;
	protected abstract choiceExecutor: IChoiceExecutor;
	protected abstract readonly plugin: QuickAdd;
	protected abstract readonly preloadedUserScripts: Map<string, unknown>;
	protected abstract readonly promptLabel?: string;
	private userScriptCommand: IUserScript | null = null;
	protected userScriptSettingsDefinition: UserScriptSettingsDefinition | undefined;
	// Slightly modified from Templater's user script engine:
	// https://github.com/SilentVoid13/Templater/blob/master/src/UserTemplates/UserTemplateParser.ts
	protected async executeUserScript(command: IUserScript) {
		// Member-aware key: preloaded values are DRILLED exports, so a command
		// drilling a different `::` member of the same file must never consume
		// another command's entry (see getUserScriptPreloadKey).
		const cacheKey = getUserScriptPreloadKey(command);
		let userScript: unknown;
		if (cacheKey !== undefined) {
			const cached = this.preloadedUserScripts.get(cacheKey);
			if (cached !== undefined) {
				userScript = cached;
				this.preloadedUserScripts.delete(cacheKey);
			}
		}

		if (userScript === undefined) {
			userScript = await getUserScript(command, this.app);
		}

		if (!userScript) {
			log.logError(`failed to load user script ${command.path}.`);
			return;
		}

		if (!command.settings) {
			command.settings = {};
		}

		const userScriptSettings = getUserScriptSettings(userScript);
		if (userScriptSettings) {
			// Initialize default values for settings before executing the script
			initializeUserScriptSettings(command.settings, userScriptSettings);
		}
		this.userScriptCommand = command;
		this.userScriptSettingsDefinition = userScriptSettings;

		try {
			await this.userScriptDelegator(userScript);
		} catch (err) {
			if (err instanceof MacroAbortError) {
				throw err;
			}
			// Report and re-throw script errors so users can debug them. This report is
			// the one the user sees - `reportError` reports a failure once (#1601), and
			// the layers above catch the same instance - so it names the CHOICE as well
			// as the script. Without that, a run-on-startup macro failing has no user
			// action to correlate it with and nothing on screen says which macro broke.
			reportError(
				err,
				`Failed to run user script ${command.name} in "${this.choice.name}"`,
			);
			throw err;
		} finally {
			this.userScriptCommand = null;
			this.userScriptSettingsDefinition = undefined;
		}
	}

	private async getResolvedUserScriptSettings(command: IUserScript) {
		return resolveScriptSettings(this.app, this.plugin, command,
			this.userScriptSettingsDefinition);
	}

	private async runScriptWithSettings(
		userScript: UserScriptFunction | { entry: UserScriptFunction },
		command: IUserScript,
	) {
		const entry = typeof userScript === "function" ? userScript : userScript.entry;
		if (typeof entry === "function") {
			return this.onExportIsFunction(entry, await this.getResolvedUserScriptSettings(command));
		}
	}


	protected async userScriptDelegator(userScript: unknown) {
		switch (typeof userScript) {
			case "function":
				if (!isUserScriptFunction(userScript)) {
					break;
				}
				if (this.userScriptCommand) {
					await this.runScriptWithSettings(
						userScript,
						this.userScriptCommand
					);
				} else {
					await this.onExportIsFunction(userScript);
				}
				break;
			case "object":
				if (isUserScriptObjectExport(userScript)) {
					await this.onExportIsObject(userScript);
				}
				break;
			case "bigint":
			case "boolean":
			case "number":
			case "string":
				this.output = userScript.toString();
				break;
			default:
				log.logError(
					`user script in macro for '${this.choice.name}' is invalid`
				);
		}
	}

	private async onExportIsFunction(
		userScript: (
			params: typeof this.params,
			settings: Record<string, unknown>
		) => Promise<unknown>,
		settings?: { [key: string]: unknown }
	) {
		this.output = await userScript(this.params, settings || {});
	}

	protected async onExportIsObject(obj: Record<string, unknown>) {
		if (Object.keys(obj).length === 0) {
			throw new Error(
				`user script in macro for '${this.choice.name}' is an empty object`
			);
		}

		if (this.userScriptCommand && isUserScriptFunction(obj.entry)) {
			await this.runScriptWithSettings(obj.entry, this.userScriptCommand);
			return;
		}

		const keys = Object.keys(obj);

		try {
			const selected = String(
				await routePrompt(this.choiceExecutor, {
					// Routed like the run's other prompts, instead of opening on a desktop
					// nobody is watching during an interactive run (#1614).
					remote: (provider) =>
						promptEngineChoice(provider, {
							items: keys.map((key) => ({ value: key, title: key })),
							placeholder: this.promptLabel,
							what: "the user-script member picker",
						}),
					// A single-member export is unambiguous, so a headless run just runs
					// it. This is why the seam takes a closure per destination rather than
					// imposing one headless behaviour: most sites abort here, and this one
					// legitimately answers itself.
					headless: () => {
						if (keys.length === 1) return Promise.resolve(keys[0]);
						throw new ChoiceAbortError(
							"This macro's user script exports multiple members and needs to ask which one to run, but this run is non-interactive. " +
							"Reference a single member (e.g. myScript::start), or re-run with the ui flag.",
						);
					},
					app: () =>
						GenericSuggester.Suggest(this.app, keys, keys, this.promptLabel),
				}),
			);

			// `Object.hasOwn`, not `obj[selected]`: the reply now travels over the wire,
			// and a member name like "constructor" would otherwise resolve to something
			// that is not an exported script at all.
			if (!Object.hasOwn(obj, selected)) {
				throw new Error(
					`This macro's user script does not export a member named "${selected}".`,
				);
			}
			await this.userScriptDelegator(obj[selected]);
		} catch (err) {
			if (err instanceof MacroAbortError) {
				throw err;
			}
			if (isCancellationError(err)) {
				throw new UserCancelError("Input cancelled by user");
			}
			throw err;
		}
	}

}
