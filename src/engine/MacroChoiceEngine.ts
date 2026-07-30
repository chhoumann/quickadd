import type IMacroChoice from "../types/choices/IMacroChoice";
import type { App, WorkspaceLeaf } from "obsidian";
import * as obsidian from "obsidian";
import type { IUserScript } from "../types/macros/IUserScript";
import type { IObsidianCommand } from "../types/macros/IObsidianCommand";
import { log } from "../logger/logManager";
import { reportError, isCancellationError } from "../utils/errorUtils";
import { CommandType } from "../types/macros/CommandType";
import { QuickAddApi } from "../quickAddApi";
import type { ICommand } from "../types/macros/ICommand";
import { QuickAddChoiceEngine } from "./QuickAddChoiceEngine";
import type { IMacro } from "../types/macros/IMacro";
import GenericSuggester from "../gui/GenericSuggester/genericSuggester";
import { routePrompt } from "../interactive/routePrompt";
import { promptEngineChoice } from "../interactive/engineChoice";
import type { IChoiceCommand } from "../types/macros/IChoiceCommand";
import type QuickAdd from "../main";
import { getQuickAddInstance } from "../quickAddInstance";
import type { IChoiceExecutor } from "../IChoiceExecutor";
import { getUserScript } from "../utilityObsidian";
import type { IWaitCommand } from "../types/macros/QuickCommands/IWaitCommand";
import type { INestedChoiceCommand } from "../types/macros/QuickCommands/INestedChoiceCommand";
import type IChoice from "../types/choices/IChoice";
import type { IEditorCommand } from "../types/macros/EditorCommands/IEditorCommand";
import { EditorCommandType } from "../types/macros/EditorCommands/EditorCommandType";
import { CutCommand } from "../types/macros/EditorCommands/CutCommand";
import { CopyCommand } from "../types/macros/EditorCommands/CopyCommand";
import { PasteCommand } from "../types/macros/EditorCommands/PasteCommand";
import { PasteWithFormatCommand } from "../types/macros/EditorCommands/PasteWithFormatCommand";
import { SelectActiveLineCommand } from "../types/macros/EditorCommands/SelectActiveLineCommand";
import { SelectLinkOnActiveLineCommand } from "../types/macros/EditorCommands/SelectLinkOnActiveLineCommand";
import { MoveCursorToFileStartCommand } from "../types/macros/EditorCommands/MoveCursorToFileStartCommand";
import { MoveCursorToFileEndCommand } from "../types/macros/EditorCommands/MoveCursorToFileEndCommand";
import { MoveCursorToLineStartCommand } from "../types/macros/EditorCommands/MoveCursorToLineStartCommand";
import { MoveCursorToLineEndCommand } from "../types/macros/EditorCommands/MoveCursorToLineEndCommand";
import { waitFor } from "src/utility";
import type { IAIAssistantCommand } from "src/types/macros/QuickCommands/IAIAssistantCommand";
import { runAIAssistant } from "src/ai/AIAssistant";
import { resolveProviderApiKey } from "src/ai/providerSecrets";
import { settingsStore } from "src/settingsStore";
import { CompleteFormatter } from "src/formatters/completeFormatter";
import type { ResolvedModel } from "src/ai/aiHelpers";
import { resolveModel } from "src/ai/aiHelpers";
import { activeModelRef } from "src/ai/Provider";
import type { IOpenFileCommand } from "../types/macros/QuickCommands/IOpenFileCommand";
import { openFile } from "../utilityObsidian";
import { TFile } from "obsidian";
import { MacroAbortError } from "../errors/MacroAbortError";
import { UserCancelError } from "../errors/UserCancelError";
import { ChoiceAbortError } from "../errors/ChoiceAbortError";
import { initializeUserScriptSettings } from "../utils/userScriptSettings";
import { getUserScriptPreloadKey } from "../utils/userScript";
import {
	migrateUserScriptSecretSettings,
	resolveUserScriptSettings,
	type UserScriptSettingsDefinition,
} from "../utils/userScriptSecrets";
import type { IConditionalCommand } from "../types/macros/Conditional/IConditionalCommand";
import type { ScriptCondition } from "../types/macros/Conditional/types";
import { evaluateCondition } from "./helpers/conditionalEvaluator";
import { handleMacroAbort } from "../utils/macroAbortHandler";
import { buildOpenFileOptions } from "./helpers/openFileOptions";
import { createVariablesProxy } from "../utils/variablesProxy";
import {
	commandListOf,
	hasCommandList,
	isUnreadableCommandList,
} from "../utils/macroUtils";

type ConditionalScriptRunner = () => Promise<unknown>;
type UserScriptFunction = (
	params: MacroChoiceEngine["params"],
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

/**
 * Command types QuickAdd used to declare and no longer does. Without this, the
 * generic message would tell a user whose data.json holds one of these that it
 * "can come from a newer version of QuickAdd" - the opposite of the truth, and
 * no help at all. A removed type is a fact we know; say the known thing.
 *
 * A Map, not an object literal: the key comes straight from a hand-edited
 * data.json, and `{}["constructor"]` is not a miss.
 */
const RETIRED_COMMAND_TYPES = new Map<string, string>([
	[
		"InfiniteAIAssistant",
		'QuickAdd has removed the "Infinite AI Assistant" command type - no released version could ever run one. Delete the step from the macro. For chunked AI prompts, use quickAddApi.ai.chunkedPrompt() in a user script.',
	],
]);

/**
 * Why a command could not be run, phrased for the person reading the notice.
 *
 * Three shapes reach here, and telling them apart is the difference between
 * actionable and baffling. A type QuickAdd used to declare gets the truth about
 * where it came from. Any other real type name is worth quoting: it is what the
 * user greps for. An entry with no usable type has nothing to quote - printing
 * `'undefined'` or `'[object Object]'` (a hand-authored package can put any JSON
 * here) would send them looking for a command type that never existed.
 */
function describeUnknownType(
	type: unknown,
	kind: "command" | "editor command" = "command",
): string {
	if (typeof type !== "string" || !type.trim()) {
		return `the saved entry has no ${kind} type, so QuickAdd cannot tell what it was meant to do. It is in .obsidian/plugins/quickadd/data.json.`;
	}

	const retired =
		kind === "command" ? RETIRED_COMMAND_TYPES.get(type) : undefined;
	if (retired) return retired;

	return `QuickAdd does not recognise the ${kind} type '${type}'. It can come from a newer version of QuickAdd, an imported package, or a hand-edited .obsidian/plugins/quickadd/data.json.`;
}

function getConditionalScriptCacheKey(condition: ScriptCondition): string {
	return `${condition.scriptPath}::${condition.exportName ?? "default"}`;
}

export class MacroChoiceEngine extends QuickAddChoiceEngine {
	public choice: IMacroChoice;
	public params: {
		app: App;
		quickAddApi: QuickAddApi;
		variables: Record<string, unknown>;
		obsidian: typeof obsidian;
		/**
		 * Aborts the macro execution immediately.
		 * @param message Optional message explaining why the macro was aborted
		 * @example
		 * if (!isValidProject(project)) {
		 *   params.abort("Invalid project name");
		 * }
		 */
		abort: (message?: string) => never;
	};
	protected output: unknown;
	protected macro: IMacro;
	protected choiceExecutor: IChoiceExecutor;
	protected readonly plugin: QuickAdd;
	private userScriptCommand: IUserScript | null;
	private userScriptSettingsDefinition: UserScriptSettingsDefinition | undefined;
	private conditionalScriptCache = new Map<string, ConditionalScriptRunner>();
	private readonly preloadedUserScripts: Map<string, unknown>;
	private readonly promptLabel?: string;
	private buildParams(
		app: App,
		plugin: QuickAdd,
		choiceExecutor: IChoiceExecutor,
		sharedVariables: Map<string, unknown>
	) {
		const variablesProxy = createVariablesProxy(sharedVariables);

		const params = {
			app,
			quickAddApi: QuickAddApi.GetApi(app, plugin, choiceExecutor),
			obsidian,
			abort: (message?: string) => {
				throw new MacroAbortError(message);
			},
		} as unknown as typeof this.params;

		// Backward compatibility: some scripts assign `QuickAdd.variables = {...}`
		// or `params.variables = {...}`.
		// Treat that as replacing the backing Map so templates can consume them.
		Object.defineProperty(params, "variables", {
			get: () => variablesProxy,
			set: (next: unknown) => {
				if (next === sharedVariables || next === variablesProxy) return;

				const entries =
					next instanceof Map
						? Array.from(next.entries()).filter(([key]) => typeof key === "string")
						: next && typeof next === "object"
							? Object.entries(next as Record<string, unknown>)
							: null;

				// Invalid assignments are ignored to avoid wiping the backing store.
				if (!entries) return;

				sharedVariables.clear();

				entries?.forEach(([key, value]) => sharedVariables.set(key, value));
			},
			enumerable: true,
			configurable: false,
		});

		return params;
	}

	private initSharedVariables(
		choiceExecutor: IChoiceExecutor,
		providedVariables?: Map<string, unknown>
	): Map<string, unknown> {
		const existingVariables = choiceExecutor.variables;

		if (providedVariables) {
			if (existingVariables && providedVariables !== existingVariables) {
				existingVariables.forEach((value, key) => {
					if (!providedVariables.has(key)) {
						providedVariables.set(key, value);
					}
				});
			}
			return providedVariables;
		}

		return existingVariables ?? new Map<string, unknown>();
	}

	constructor(
		app: App,
		plugin: QuickAdd,
		choice: IMacroChoice,
		choiceExecutor: IChoiceExecutor,
		variables: Map<string, unknown>,
		preloadedUserScripts?: Map<string, unknown>,
		promptLabel?: string,
		private readonly originLeaf: WorkspaceLeaf | null = null,
	) {
		super(app);
		this.choice = choice;
		this.plugin = plugin;
		this.macro = choice?.macro;
		this.choiceExecutor = choiceExecutor;
		this.preloadedUserScripts = preloadedUserScripts ?? new Map();
		this.promptLabel = promptLabel;
		this.userScriptSettingsDefinition = undefined;
		const sharedVariables = this.initSharedVariables(
			choiceExecutor,
			variables
		);
		this.choiceExecutor.variables = sharedVariables;
		this.params = this.buildParams(app, plugin, choiceExecutor, sharedVariables);
	}

	async run(): Promise<void> {
		// `!this.macro.commands` is truthiness, so it used to wave through the two
		// shapes that then failed outside the UI (#1593): an array-turned-object
		// reached `for..of` and threw a bare "i is not iterable" at the user, and a
		// string reached it INTACT (strings are iterable), so the macro reported
		// success having walked its own characters and done nothing at all.
		//
		// THROWS rather than returning: none of the macro ran, so this is a
		// failure and every caller has to see it as one. Returning quietly would
		// let `quickadd:run` answer `ok: true` and automation carry on as if the
		// macro had done its job (#1606's contract). The throw surfaces as one
		// Notice through the executor's error path.
		if (isUnreadableCommandList(this.macro?.commands)) {
			throw new Error(
				`Could not read the commands for macro '${this.choice.name}'. The saved value is not a list of commands - QuickAdd has not changed it. It is in .obsidian/plugins/quickadd/data.json.`
			);
		}

		const commands = commandListOf(this.macro?.commands);
		if (commands.length === 0) {
			// `commands: []` is the HEALTHY default (QuickAddMacro's constructor),
			// so an empty list stays as quiet as it was before this guard existed -
			// otherwise every freshly created macro, and every launch with an
			// unpopulated run-on-startup macro, would raise a 15s error notice.
			// Only a MISSING macro is worth saying anything about.
			if (!hasCommandList(this.macro?.commands)) {
				log.logError(
					`No commands in the macro for choice '${this.choice.name}'`
				);
			}
			return;
		}

		await this.executeCommands(commands);
	}

	public getOutput(): unknown {
		return this.output;
	}

	protected async executeCommands(commands: ICommand[]) {
		try {
			for (const command of commands) {
				// A null/undefined entry is corruption, not a command, and the old
				// `isRecord` inside every type guard was the only thing keeping it
				// from throwing here. It stays SILENT: the same shape package import
				// skips without comment (packageImportService), and a red notice per
				// hole would bury the #1583 resilience work under noise.
				if (!command) continue;

				// A switch, not the old flat `if (isX(command))` chain: that chain had
				// no else, so a type it did not know was dropped on the floor with no
				// error, no notice and no log, and the macro still reported success
				// (#1571). The `never` assignment in the default branch makes adding a
				// CommandType without a handler a tsc error, so the hole cannot come
				// back. `type` is all the old guards ever checked, so the casts are
				// exactly as strict as what they replaced.
				switch (command.type) {
					case CommandType.Obsidian:
						this.executeObsidianCommand(command as IObsidianCommand);
						break;
					case CommandType.UserScript:
						await this.executeUserScript(command as IUserScript);
						break;
					case CommandType.Choice:
						await this.executeChoice(command as IChoiceCommand);
						break;
					case CommandType.Wait:
						await waitFor((command as IWaitCommand).time);
						break;
					case CommandType.NestedChoice:
						await this.executeNestedChoice(command as INestedChoiceCommand);
						break;
					case CommandType.EditorCommand:
						await this.executeEditorCommand(command as IEditorCommand);
						break;
					case CommandType.AIAssistant:
						await this.executeAIAssistant(command as IAIAssistantCommand);
						break;
					case CommandType.OpenFile:
						await this.executeOpenFile(command as IOpenFileCommand);
						break;
					case CommandType.Conditional:
						await this.executeConditional(command as IConditionalCommand);
						break;
					default: {
						// Compile-time exhaustiveness (the idiom executeEditorCommand
						// already uses) AND a runtime shout: `type` is only typed at the
						// edges, so a newer QuickAdd's data.json read by an older one -
						// which our own downgrade recipe produces - really does arrive
						// here with a string TypeScript says is impossible.
						const exhaustiveCheck: never = command.type;
						this.reportUnrunnableCommand(
							command,
							describeUnknownType(exhaustiveCheck),
						);
						break;
					}
				}
			}
		} catch (error) {
			if (
				handleMacroAbort(error, {
					logPrefix: "Macro execution aborted",
					noticePrefix: "Macro execution aborted",
					defaultReason: "Macro execution aborted",
				})
			) {
				this.choiceExecutor.signalAbort?.(error);
				return;
			}
			throw error;
		}
	}

	/**
	 * Say out loud that a command was skipped, then carry on with the rest of
	 * the macro - the same shape `executeObsidianCommand` uses for a command
	 * whose plugin is gone. Skipping is the safer half of the choice: the step
	 * did nothing either way, and aborting a macro on load-order noise would
	 * take the file-writing steps that DID work with it. The shout is the half
	 * that was missing (#1571) - without it the macro reports success and the
	 * user's next step inherits the hole, e.g. an unset output variable that
	 * turns into a mid-macro prompt asking them to type the missing value.
	 *
	 * One notice per skipped command, not per type: the same cadence as every
	 * other skip in this file, and a macro that holds several is exactly the
	 * case where seeing each one matters.
	 */
	private reportUnrunnableCommand(command: ICommand, reason: string): void {
		const name =
			typeof command?.name === "string" && command.name.trim()
				? `'${command.name}'`
				: "an unnamed command";

		// "QuickAdd did not stop the macro" rather than "the rest of the macro
		// ran": this fires BEFORE the rest runs, and when the skipped step is the
		// last one there is no rest. What the user needs from the tail is that
		// the macro was not aborted, so the result they get is a partial one.
		log.logError(
			`Skipped ${name} in the macro for '${this.choice.name}': ${reason} QuickAdd did not stop the macro, so its result may be incomplete.`
		);
	}

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
		if (
			await migrateUserScriptSecretSettings(
				this.app,
				command,
				this.userScriptSettingsDefinition,
			)
		) {
			await this.plugin.saveSettings?.();
		}

		return resolveUserScriptSettings(
			this.app,
			command,
			this.userScriptSettingsDefinition,
		);
	}

	private async runScriptWithSettings(
		userScript:
			| ((
					params: typeof this.params,
					settings: Record<string, unknown>
			  ) => Promise<unknown>)
			| {
					entry: (
						params: typeof this.params,
						settings: Record<string, unknown>
					) => Promise<unknown>;
			  },
		command: IUserScript
	) {
		if (
			typeof userScript !== "function" &&
			userScript.entry &&
			typeof userScript.entry === "function"
		) {
			return await this.onExportIsFunction(
				userScript.entry,
				await this.getResolvedUserScriptSettings(command),
			);
		}

		if (typeof userScript === "function") {
			return await this.onExportIsFunction(
				userScript,
				await this.getResolvedUserScriptSettings(command),
			);
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

		if (this.userScriptCommand && typeof obj.entry === "function") {
			await this.runScriptWithSettings(
				obj as {
					entry: (
						params: typeof this.params,
						settings: Record<string, unknown>
					) => Promise<void>;
				},
				this.userScriptCommand
			);
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

	protected executeObsidianCommand(command: IObsidianCommand) {
		// @ts-ignore
		const registry = this.app.commands.commands;
		// When the command registry is available, a missing id means the source
		// plugin was disabled/uninstalled; executeCommandById would silently no-op,
		// so surface a clear error instead of letting the macro look successful.
		if (registry && !registry[command.commandId]) {
			log.logError(
				`Obsidian command '${command.name}' is no longer available.`
			);
			return;
		}

		// @ts-ignore
		this.app.commands.executeCommandById(command.commandId);
	}

	protected async executeChoice(command: IChoiceCommand) {
		let targetChoice: IChoice;
		try {
			targetChoice = this.plugin.getChoiceById(command.choiceId);
		} catch (error) {
			// getChoiceById throws ONLY a "Choice <id> not found" error when the
			// referenced choice was deleted; surface a friendly message naming the
			// stored command and skip instead of aborting the whole macro. Rethrow
			// anything else so a genuine fault isn't silently swallowed (which would
			// let the macro continue in a corrupted state).
			const message = error instanceof Error ? error.message : String(error);
			if (!/not found/i.test(message)) throw error;
			log.logError(
				`choice '${command.name}' could not be found.`
			);
			return;
		}

		await this.choiceExecutor.execute(targetChoice);
		const abort = this.choiceExecutor.consumeAbortSignal?.();
		if (abort) {
			throw abort;
		}
	}

	private async executeNestedChoice(command: INestedChoiceCommand) {
		const choice: IChoice = command.choice;
		if (!choice) {
			log.logError(`choice in ${command.name} is invalid`);
			return;
		}

		await this.choiceExecutor.execute(choice);
		const abort = this.choiceExecutor.consumeAbortSignal?.();
		if (abort) {
			throw abort;
		}
	}

	private async executeEditorCommand(command: IEditorCommand) {
		switch (command.editorCommandType) {
			case EditorCommandType.Cut:
				await CutCommand.run(this.app);
				break;
			case EditorCommandType.Copy:
				await CopyCommand.run(this.app);
				break;
			case EditorCommandType.Paste:
				await PasteCommand.run(this.app);
				break;
			case EditorCommandType.PasteWithFormat:
				await PasteWithFormatCommand.run(this.app);
				break;
			case EditorCommandType.SelectActiveLine:
				SelectActiveLineCommand.run(this.app);
				break;
			case EditorCommandType.SelectLinkOnActiveLine:
				SelectLinkOnActiveLineCommand.run(this.app);
				break;
			case EditorCommandType.MoveCursorToFileStart:
				MoveCursorToFileStartCommand.run(this.app);
				break;
			case EditorCommandType.MoveCursorToFileEnd:
				MoveCursorToFileEndCommand.run(this.app);
				break;
			case EditorCommandType.MoveCursorToLineStart:
				MoveCursorToLineStartCommand.run(this.app);
				break;
			case EditorCommandType.MoveCursorToLineEnd:
				MoveCursorToLineEndCommand.run(this.app);
				break;
			default: {
				// Skip and shout, like the outer loop - this used to throw, which
				// aborted the whole macro. Same threat model, so it deserves the same
				// answer: a newer QuickAdd that adds an EditorCommandType writes a
				// data.json an older one still has to read, and one unknown editor
				// step is no reason to take the file-writing steps around it down
				// with it.
				const exhaustiveCheck: never = command.editorCommandType;
				this.reportUnrunnableCommand(
					command,
					describeUnknownType(exhaustiveCheck, "editor command"),
				);
			}
		}
	}

	private async executeAIAssistant(command: IAIAssistantCommand) {
		if (settingsStore.getState().disableOnlineFeatures) {
			throw new Error(
				"Blocking request: Online features are disabled in settings."
			);
		}

		const aiSettings = settingsStore.getState().ai;

		let resolved: ResolvedModel | undefined;
		if (command.model === "Ask me") {
			resolved = await this.pickModelInteractively();
		} else {
			// Prefer the pinned provider-scoped ref — but only while it matches
			// the legacy string (a stale ref from a downgrade edit must not
			// override the visible selection). Bare names resolve first-match,
			// as they always have.
			resolved = resolveModel(
				activeModelRef(command.model, command.modelRef) ?? command.model,
			);
			if (!resolved) {
				throw new Error(
					`Model ${command.model} not found with any provider.`,
				);
			}
		}

		const { model, provider: modelProvider } = resolved;

		const formatter = new CompleteFormatter(
			this.app,
			getQuickAddInstance(),
			this.choiceExecutor
		);
		// Same run context every other prompt surface gets (issue #1546): a
		// {{VALUE}} inside the AI prompt template names the choice that is asking
		// instead of prompting generically. Scoped per command id, like
		// executeOpenFile below: a macro can hold several AI commands, and their
		// prompts must not share one draft.
		formatter.setPromptRunContext({
			choiceName: this.choice?.name,
			draftScopeId: `${this.choice?.id ?? "macro"}#aiAssistant:${command.id}`,
		});

		const apiKey = await resolveProviderApiKey(this.app, modelProvider);

		const aiOutputVariables = await runAIAssistant(
			this.app,
			{
				apiKey,
				model,
				provider: modelProvider,
				outputVariableName: command.outputVariableName,
				promptTemplate: command.promptTemplate,
				promptTemplateFolder: aiSettings.promptTemplatesFolderPath,
				systemPrompt: command.systemPrompt,
				showAssistantMessages: aiSettings.showAssistant,
				modelOptions: command.modelParameters,
				interactive: this.choiceExecutor.interactive,
				promptProvider: this.choiceExecutor.promptProvider,
			},
			async (input: string) => {
				return formatter.formatFileContent(input);
			}
		);

		for (const key in aiOutputVariables) {
				this.choiceExecutor.variables.set(key, aiOutputVariables[key]);
		}
	}

	/**
	 * The "Ask me" model picker. Entries are provider-scoped so two providers
	 * serving the same model name are distinguishable — picking from a flat
	 * name list would silently first-match, defeating the point of asking.
	 */
	private async pickModelInteractively(): Promise<ResolvedModel> {
		const providers = settingsStore.getState().ai.providers;
		const entries: { label: string; qualified: string; resolved: ResolvedModel }[] =
			providers.flatMap((provider) =>
				provider.models.map((model) => ({
					label: `${model.name} (${provider.name})`,
					qualified: `${provider.id ?? provider.name}/${model.name}`,
					resolved: { provider, model },
				})),
			);

		if (entries.length === 0) {
			throw new Error(
				"No AI models are configured. Add a provider with models in the AI Assistant settings.",
			);
		}

		// Route to a remote interactive session (Raycast) when one is driving.
		const promptProvider = this.choiceExecutor.promptProvider;
		if (promptProvider) {
			const picked = String(
				await promptProvider.suggester(
					entries.map((entry) => entry.label),
					entries.map((entry) => entry.qualified),
					"Select a model",
				),
			);
			const entry = entries.find((e) => e.qualified === picked);
			if (!entry) {
				throw new Error(`Model ${picked} not found with any provider.`);
			}
			return entry.resolved;
		}

		if (this.choiceExecutor.interactive === false) {
			// Non-interactive run (CLI without `ui`): the "Ask me" model picker has
			// no one to answer it. Abort with an actionable error instead of hanging.
			throw new ChoiceAbortError(
				"This AI command is set to \"Ask me\" for the model, but this run is non-interactive. " +
					"Pick a specific model in the command, or re-run with the ui flag.",
			);
		}

		try {
			return await GenericSuggester.Suggest(
				this.app,
				entries.map((entry) => entry.label),
				entries.map((entry) => entry.resolved),
				"Select a model",
			);
		} catch (error) {
			if (isCancellationError(error)) {
				throw new UserCancelError("Input cancelled by user");
			}
			throw error;
		}
	}

	private async executeConditional(command: IConditionalCommand) {
		const shouldRunThenBranch = await evaluateCondition(command.condition, {
			variables: this.params.variables,
			evaluateScriptCondition: async (condition: ScriptCondition) =>
				await this.evaluateScriptCondition(condition),
		});

		const branch = shouldRunThenBranch
			? command.thenCommands
			: command.elseCommands;

		// An absent branch is normal (a conditional with no else), so it stays
		// silent. A branch we could not read is not: say so rather than skipping
		// it as if the user had left it empty (#1593).
		//
		// THROWS rather than returning, for the same reason run() does, and one
		// more: returning here only exits executeConditional, so the outer loop
		// would carry on with every command AFTER the conditional - running
		// file-writing and script commands that were only ever meant to follow a
		// branch that never ran.
		if (isUnreadableCommandList(branch)) {
			throw new Error(
				`Could not read the ${shouldRunThenBranch ? "then" : "else"} commands for '${command.name}'. The saved value is not a list of commands - QuickAdd has not changed it. It is in .obsidian/plugins/quickadd/data.json.`
			);
		}

		if (!Array.isArray(branch) || branch.length === 0) {
			return;
		}

		await this.executeCommands(branch);

		// executeCommands swallows aborts (signals + returns) so the inner branch
		// loop stops; re-throw the pending abort here so the outer macro loop halts
		// too instead of running the commands after this conditional.
		const abort = this.choiceExecutor.consumeAbortSignal?.();
		if (abort) {
			throw abort;
		}
	}

	public async runSubset(commands: ICommand[]): Promise<void> {
		if (!commands?.length) return;
		await this.executeCommands(commands);
	}

	public setOutput(value: unknown): void {
		this.output = value;
	}

	private async evaluateScriptCondition(
		condition: ScriptCondition
	): Promise<boolean> {
		const cacheKey = getConditionalScriptCacheKey(condition);

		let runner = this.conditionalScriptCache.get(cacheKey);

		if (!runner) {
			runner = await this.loadConditionalScript(condition);

			if (!runner) return false;

			this.conditionalScriptCache.set(cacheKey, runner);
		}

		let result: unknown;

		try {
			result = await runner();
		} catch (error) {
			reportError(
				error,
				`Failed to evaluate conditional script '${condition.scriptPath}'.`
			);
			throw error;
		}

		if (typeof result !== "boolean") {
			log.logWarning(
				`Conditional script '${condition.scriptPath}' must return a boolean result.`
			);
			return false;
		}

		return result;
	}

	private async loadConditionalScript(
		condition: ScriptCondition
	): Promise<ConditionalScriptRunner | undefined> {
		try {
			const script = await getUserScript(
				this.buildConditionalUserScript(condition),
				this.app
			);

			if (script === undefined || script === null) {
				return undefined;
			}

			if (typeof script === "function") {
				return async () => await script(this.params);
			}

			return async () => script;
		} catch (error) {
			reportError(
				error,
				`Failed to load conditional script '${condition.scriptPath}'.`
			);
			throw error;
		}
	}

	private buildConditionalUserScript(
		condition: ScriptCondition
	): IUserScript {
		return {
			id: `conditional-script-${getConditionalScriptCacheKey(condition)}`,
			name: condition.exportName
				? `${condition.scriptPath}::${condition.exportName}`
				: condition.scriptPath,
			type: CommandType.UserScript,
			path: condition.scriptPath,
			settings: {},
		};
	}

	private async executeOpenFile(command: IOpenFileCommand) {
		try {
			const formatter = new CompleteFormatter(
				this.app,
				getQuickAddInstance(),
				this.choiceExecutor
			);
			// This formatter is built per command, so a {{VALUE}} in the path only
			// gets the macro's name and its own draft scope if they are handed over
			// (issue #1546). Scoped per command id: a macro can hold several Open
			// File commands, and they must not share one draft.
			formatter.setPromptRunContext({
				choiceName: this.choice?.name,
				draftScopeId: `${this.choice?.id ?? "macro"}#openFile:${command.id}`,
			});

			const resolvedPath = await formatter.formatFileName(
				command.filePath,
				"filePath",
			);
			const normalizedPath = resolvedPath.replace(/\\/g, "/");

			// Validate path segments to prevent traversal attacks. A substring check
			// would wrongly reject legitimate filenames that merely contain ".." (e.g.
			// 'log..2024.md') or "//"; only a literal '..' path segment or an empty
			// segment (from '//') is an actual traversal/malformed path.
			const segments = normalizedPath.split("/");
			const hasTraversal = segments.some(
				(segment, index) =>
					segment === ".." ||
					// An empty segment is a doubled slash; the leading slash of an
					// absolute path is allowed (index 0), as is a single trailing slash.
					(segment === "" && index !== 0 && index !== segments.length - 1)
			);
			if (hasTraversal) {
				log.logError(`OpenFile: Path traversal not allowed in '${normalizedPath}'`);
				return;
			}

			const file = this.app.vault.getAbstractFileByPath(normalizedPath);

			if (!file || !(file instanceof TFile)) {
				log.logError(`OpenFile: '${normalizedPath}' does not exist or is not a file`);
				return;
			}

			const openOptions = buildOpenFileOptions(command);

			await openFile(this.app, file, {
				...openOptions,
				originLeaf: this.originLeaf,
			});
		} catch (error) {
			log.logError(`OpenFile: Failed to open file '${command.filePath}': ${error.message}`);
		}
	}
}
