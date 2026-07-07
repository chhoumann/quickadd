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

type ConditionalScriptRunner = () => Promise<unknown>;
type UserScriptFunction = (
	params: MacroChoiceEngine["params"],
	settings: Record<string, unknown>
) => Promise<unknown>;

function hasCommandType(
	command: unknown,
	type: CommandType
): command is ICommand {
	return isRecord(command) && command.type === type;
}

function isObsidianCommand(command: unknown): command is IObsidianCommand {
	return hasCommandType(command, CommandType.Obsidian);
}

function isUserScriptCommand(command: unknown): command is IUserScript {
	return hasCommandType(command, CommandType.UserScript);
}

function isChoiceCommand(command: unknown): command is IChoiceCommand {
	return hasCommandType(command, CommandType.Choice);
}

function isWaitCommand(command: unknown): command is IWaitCommand {
	return hasCommandType(command, CommandType.Wait);
}

function isNestedChoiceCommand(
	command: unknown
): command is INestedChoiceCommand {
	return hasCommandType(command, CommandType.NestedChoice);
}

function isEditorCommand(command: unknown): command is IEditorCommand {
	return hasCommandType(command, CommandType.EditorCommand);
}

function isAIAssistantCommand(
	command: unknown
): command is IAIAssistantCommand {
	return hasCommandType(command, CommandType.AIAssistant);
}

function isOpenFileCommand(command: unknown): command is IOpenFileCommand {
	return hasCommandType(command, CommandType.OpenFile);
}

function isConditionalCommand(
	command: unknown
): command is IConditionalCommand {
	return hasCommandType(command, CommandType.Conditional);
}
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
		if (!this.macro || !this.macro.commands) {
			log.logError(
				`No commands in the macro for choice '${this.choice.name}'`
			);
			return;
		}

		await this.executeCommands(this.macro.commands);
	}

	public getOutput(): unknown {
		return this.output;
	}

	protected async executeCommands(commands: ICommand[]) {
		try {
			for (const command of commands) {
				if (isObsidianCommand(command))
					this.executeObsidianCommand(command);
				if (isUserScriptCommand(command))
					await this.executeUserScript(command);
				if (isChoiceCommand(command))
					await this.executeChoice(command);
				if (isWaitCommand(command)) {
					await waitFor(command.time);
				}
				if (isNestedChoiceCommand(command)) {
					await this.executeNestedChoice(command);
				}
				if (isEditorCommand(command)) {
					await this.executeEditorCommand(command);
				}
				if (isAIAssistantCommand(command)) {
					await this.executeAIAssistant(command);
				}
				if (isOpenFileCommand(command)) {
					await this.executeOpenFile(command);
				}
				if (isConditionalCommand(command)) {
					await this.executeConditional(command);
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
			// Report and re-throw script errors so users can debug them
			reportError(err, `Failed to run user script ${command.name}`);
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

		// Non-interactive run (CLI without `ui`): a user script that exports an object
		// of MULTIPLE named members opens a picker to choose which to run, which has
		// no one to answer it headlessly. A single-member export is unambiguous, so
		// run it directly (the interactive path keeps its existing picker behaviour).
		if (this.choiceExecutor.interactive === false) {
			const keys = Object.keys(obj);
			if (keys.length === 1) {
				await this.userScriptDelegator(obj[keys[0]]);
				return;
			}
			throw new ChoiceAbortError(
				"This macro's user script exports multiple members and needs to ask which one to run, but this run is non-interactive. " +
					"Reference a single member (e.g. myScript::start), or re-run with the ui flag.",
			);
		}

		try {
			const keys = Object.keys(obj);
			const selected: string = await GenericSuggester.Suggest(
				this.app,
				keys,
				keys,
				this.promptLabel,
			);

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
				const exhaustiveCheck: never = command.editorCommandType;
				throw new Error(`Unhandled editor command type: ${exhaustiveCheck}`);
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

			const resolvedPath = await formatter.formatFileName(command.filePath, "");
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
