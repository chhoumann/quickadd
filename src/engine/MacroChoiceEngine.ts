import { executeMacroAI } from "./macroAI";
import { withDispatch, type ChoiceChain } from "./choiceChain";
import { templaterRerunAfter, warnDeprecatedOnce } from "src/utils/templaterRerunDeprecation";
import type IMacroChoice from "../types/choices/IMacroChoice";
import type { App, WorkspaceLeaf } from "obsidian";
import type { IUserScript } from "../types/macros/IUserScript";
import type { IObsidianCommand } from "../types/macros/IObsidianCommand";
import { log } from "../logger/logManager";
import { reportError } from "../utils/errorUtils";
import { CommandType } from "../types/macros/CommandType";
import type { ICommand } from "../types/macros/ICommand";
import type { LoadedUserScript } from "../utils/userScript";
import { executeUserScript, type ScriptParameters } from "./userScriptExecution";
import { createScriptParameters } from "./scriptParameters";
import { QuickAddEngine } from "./QuickAddEngine";
import type { IMacro } from "../types/macros/IMacro";
import type { IChoiceCommand } from "../types/macros/IChoiceCommand";
import type { ChoiceRuntimePlugin } from "../types/pluginContext";
import type { FormatterExecutionRuntime } from "../formatters/formatterRuntime";
import type { IChoiceExecutor } from "../IChoiceExecutor";
import { getUserScript } from "../utils/userScript";
import type { IWaitCommand } from "../types/macros/QuickCommands/IWaitCommand";
import type { INestedChoiceCommand } from "../types/macros/QuickCommands/INestedChoiceCommand";
import type IChoice from "../types/choices/IChoice";
import type { IEditorCommand } from "../types/macros/EditorCommands/IEditorCommand";
import { executeEditorCommand } from "./editorCommands";
import { waitFor } from "src/utils/waitFor";
import type { IAIAssistantCommand } from "src/types/macros/QuickCommands/IAIAssistantCommand";
import { CompleteFormatter } from "src/formatters/completeFormatter";
import type { IOpenFileCommand } from "../types/macros/QuickCommands/IOpenFileCommand";
import { openFile } from "../utils/fileOpening";
import { escapesVaultBoundary } from "../utils/vaultPathBoundary";
import { executeObsidianCommand, getObsidianCommands } from "../utils/obsidianInternals";
import { TFile } from "obsidian";
import { MacroAbortError } from "../errors/MacroAbortError";
import type { IConditionalCommand } from "../types/macros/Conditional/IConditionalCommand";
import type { ScriptCondition } from "../types/macros/Conditional/types";
import { evaluateCondition } from "./helpers/conditionalEvaluator";
import { namedCurrentNote } from "../utils/currentFile";
import { handleMacroAbort } from "../utils/macroAbortHandler";
import { buildOpenFileOptions } from "./helpers/openFileOptions";
import {
	commandListOf,
	hasCommandList,
	isUnreadableCommandList,
} from "../utils/macroUtils";

import { classifyStep } from "../preflight/macroCommandRole";
import { isDiscoveryInputBoundary } from "../preflight/macroFormRoster";
import { withPreparedChoiceInputs } from "../preflight/preparedChoiceInputs";

type ConditionalScriptRunner = () => Promise<unknown>;
/**
 * Command types QuickAdd no longer declares, so a data.json holding one is not
 * told it may come from a newer version. A Map, because the key comes from
 * hand-edited data.json and `{}["constructor"]` is not a miss.
 */
const RETIRED_COMMAND_TYPES = new Map<string, string>([
	[
		"InfiniteAIAssistant",
		'The "Infinite AI Assistant" command type was removed - no released version could ever run one. Delete the step from the macro. For chunked AI prompts, use quickAddApi.ai.chunkedPrompt() in a user script.',
	],
]);

/**
 * Why a command could not be run, for the notice. A retired type says so,
 * another real type name is quoted, and an entry with no usable type quotes
 * nothing rather than `'undefined'` or `'[object Object]'`.
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

export class MacroChoiceEngine extends QuickAddEngine {
	public choice: IMacroChoice;
	public params: ScriptParameters;
	protected output: unknown;
	/**
	 * The last step that ran and was neither a Wait nor a Conditional, for the
	 * Templater re-run notice. Kept on the engine so it carries across
	 * Conditional branches, which run through a nested executeCommands.
	 */
	private previousStep: ICommand | undefined;
	protected macro: IMacro;
	protected choiceExecutor: IChoiceExecutor;
	protected readonly plugin: ChoiceRuntimePlugin;
	protected readonly runtime: FormatterExecutionRuntime;
	private conditionalScriptCache = new Map<string, ConditionalScriptRunner>();
	private readonly preloadedUserScripts: Map<string, LoadedUserScript>;
	private readonly promptLabel?: string;
	constructor(
		app: App,
		plugin: ChoiceRuntimePlugin,
		runtime: FormatterExecutionRuntime,
		choice: IMacroChoice,
		choiceExecutor: IChoiceExecutor,
		variables: Map<string, unknown>,
		preloadedUserScripts?: Map<string, LoadedUserScript>,
		promptLabel?: string,
		private readonly originLeaf: WorkspaceLeaf | null = null,
		/** This run's {@link ChoiceChain}; a macro run on its own is the whole chain. */
		protected readonly chain: ChoiceChain = [choice],
	) {
		super(app);
		this.choice = choice;
		this.plugin = plugin;
		this.runtime = runtime;
		this.macro = choice?.macro;
		this.choiceExecutor = choiceExecutor;
		this.preloadedUserScripts = preloadedUserScripts ?? new Map();
		this.promptLabel = promptLabel;
		this.params = createScriptParameters({ app, plugin, runtime, choiceExecutor, variables, chain });
	}

	async run(): Promise<void> {
		// A non-array `commands` fails outright: an object throws in `for..of`, and
		// a string would walk its own characters and report success. Throws,
		// since none of the macro ran and callers must see a failure.
		if (isUnreadableCommandList(this.macro?.commands)) {
			throw new Error(
				`Could not read the commands for macro '${this.choice.name}'. The saved value is not a list of commands - QuickAdd has not changed it. It is in .obsidian/plugins/quickadd/data.json.`
			);
		}

		const commands = commandListOf(this.macro?.commands);
		if (commands.length === 0) {
			// `commands: []` is the healthy default, so an empty list stays quiet;
			// only a missing macro is reported.
			if (!hasCommandList(this.macro?.commands)) {
				log.logError(
					`No commands in the macro for choice '${this.choice.name}'`
				);
			}
			return;
		}

		this.previousStep = undefined;
		await this.executeCommands(commands);
	}

	public getOutput(): unknown {
		return this.output;
	}

	protected async executeCommands(commands: ICommand[]) {
		try {
			for (const [index, command] of commands.entries()) {
				// A null entry is corruption, skipped silently as package import skips it.
				if (!command) continue;

				// The `never` default makes a CommandType without a handler a tsc error.
				const role = command.type === CommandType.Choice || command.type === CommandType.NestedChoice
					? classifyStep(command, (id) => this.plugin.findChoiceById(id))
					: null;
				const rerunAfter = templaterRerunAfter(this.previousStep, command, (id) => this.plugin.findChoiceById(id));
				if (rerunAfter) {
					warnDeprecatedOnce(
						`templater-rerun:${this.choice.id}:${command.id}`,
						`Macro '${this.choice.name}' runs "Templater: Replace templates in the active file" after '${rerunAfter}'. QuickAdd already runs Templater in the notes it creates and captures, so this step is deprecated and can run template code twice. Remove it from the macro.`,
					);
				}
				if (command.type !== CommandType.Wait && command.type !== CommandType.Conditional) {
					this.previousStep = command;
				}
				const resumeInputs = role?.collect.kind === "scanChoice" &&
					isDiscoveryInputBoundary(role.collect.choice, this.choiceExecutor.variables.get("value"));
				await withPreparedChoiceInputs(this.choiceExecutor, command.id, async () => {
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
							// `type` is only typed at the edges: an older QuickAdd reading a
							// newer data.json (as a downgrade produces) really arrives here.
							const exhaustiveCheck: never = command.type;
							this.reportUnrunnableCommand(
								command,
								describeUnknownType(exhaustiveCheck),
							);
							break;
						}
					}
				});
				if (resumeInputs) {
					await this.choiceExecutor.prepareMacroInputs(this.choice, commands.slice(index + 1));
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
	 * Reports a skipped command and carries on, as for a command whose plugin is
	 * gone: aborting would take the steps that worked with it, while silence lets
	 * the macro report success. One notice per skipped command.
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


	protected async executeUserScript(command: IUserScript): Promise<void> {
		const result = await executeUserScript(command, {
			app: this.app,
			plugin: this.plugin,
			choiceName: this.choice.name,
			params: this.params,
			executor: this.choiceExecutor,
			preloadedUserScripts: this.preloadedUserScripts,
			promptLabel: this.promptLabel,
		});
		if (result) this.output = result.output;
	}

	protected executeObsidianCommand(command: IObsidianCommand) {
		const registry = getObsidianCommands(this.app);
		// When the command registry is available, a missing id means the source
		// plugin was disabled/uninstalled; executeCommandById would silently no-op,
		// so surface a clear error instead of letting the macro look successful.
		if (registry && !registry[command.commandId]) {
			log.logError(
				`Obsidian command '${command.name}' is no longer available.`
			);
			return;
		}

		withDispatch({ chain: this.chain, currentNote: namedCurrentNote(this.choiceExecutor) }, () =>
			executeObsidianCommand(this.app, command.commandId),
		);
	}

	protected async executeChoice(command: IChoiceCommand) {
		// A deleted choice is skipped with a message naming the stored command,
		// rather than aborting the whole macro.
		const targetChoice = this.plugin.findChoiceById(command.choiceId);
		if (!targetChoice) {
			log.logError(`choice '${command.name}' could not be found.`);
			return;
		}

		await this.choiceExecutor.execute(targetChoice, this.chain);
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

		await this.choiceExecutor.execute(choice, this.chain);
		const abort = this.choiceExecutor.consumeAbortSignal?.();
		if (abort) {
			throw abort;
		}
	}

	private async executeEditorCommand(command: IEditorCommand) {
		if (await executeEditorCommand(this.app, command)) return;
		// Skip and report like the outer loop: a newer QuickAdd may add an
		// EditorCommandType that an older one still reads.
		this.reportUnrunnableCommand(
			command,
			describeUnknownType(command.editorCommandType, "editor command"),
		);
	}

	private async executeAIAssistant(command: IAIAssistantCommand) {
		return executeMacroAI(this.app, this.plugin, this.runtime, this.choice, this.choiceExecutor, this.chain, command);
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

		// An absent branch is normal; an unreadable one throws, since returning
		// here would let the outer loop run the commands meant to follow a branch
		// that never ran.
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
				this.plugin,
				this.choiceExecutor,
				this.runtime,
			);
			// This formatter is built per command, so it needs the macro's name and
			// a draft scope per command id: several Open File commands must not
			// share one draft.
			formatter.setPromptRunContext({
				choiceName: this.choice?.name,
				draftScopeId: `${this.choice?.id ?? "macro"}#openFile:${command.id}`,
			});
			formatter.choiceChain = this.chain;

			const resolvedPath = await formatter.formatFileName(
				command.filePath,
				"filePath",
			);
			const normalizedPath = resolvedPath.replace(/\\/g, "/");

			// Segment-based, so a name that merely contains ".." ('log..2024.md')
			// still opens.
			if (escapesVaultBoundary(normalizedPath)) {
				log.logError(`OpenFile: '${normalizedPath}' points outside the vault`);
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
			// A dismissed prompt in the path, or an abort, stops the macro like any other step.
			if (error instanceof MacroAbortError) throw error;
			log.logError(`OpenFile: Failed to open file '${command.filePath}': ${error.message}`);
		}
	}
}
