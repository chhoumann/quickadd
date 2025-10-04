import type IMacroChoice from "../types/choices/IMacroChoice";
import type { App } from "obsidian";
import * as obsidian from "obsidian";
import type { IUserScript } from "../types/macros/IUserScript";
import type { IObsidianCommand } from "../types/macros/IObsidianCommand";
import { log } from "../logger/logManager";
import { reportError } from "../utils/errorUtils";
import { ErrorLevel } from "../logger/errorLevel";
import { CommandType } from "../types/macros/CommandType";
import { QuickAddApi } from "../quickAddApi";
import type { ICommand } from "../types/macros/ICommand";
import { QuickAddChoiceEngine } from "./QuickAddChoiceEngine";
import type { IMacro } from "../types/macros/IMacro";
import GenericSuggester from "../gui/GenericSuggester/genericSuggester";
import type { IChoiceCommand } from "../types/macros/IChoiceCommand";
import QuickAdd from "../main";
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
import { waitFor } from "src/utility";
import type { IAIAssistantCommand } from "src/types/macros/QuickCommands/IAIAssistantCommand";
import { runAIAssistant } from "src/ai/AIAssistant";
import { settingsStore } from "src/settingsStore";
import { CompleteFormatter } from "src/formatters/completeFormatter";
import {
	getModelByName,
	getModelNames,
	getModelProvider,
} from "src/ai/aiHelpers";
import type { Model } from "src/ai/Provider";
import type { IOpenFileCommand } from "../types/macros/QuickCommands/IOpenFileCommand";
import { openFile } from "../utilityObsidian";
import { TFile } from "obsidian";
import { MacroAbortError } from "../errors/MacroAbortError";
import { isCancellationError } from "../utils/errorUtils";

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

	constructor(
		app: App,
		plugin: QuickAdd,
		choice: IMacroChoice,
		choiceExecutor: IChoiceExecutor,
		variables: Map<string, unknown>
	) {
		super(app);
		this.choice = choice;
		this.plugin = plugin;
		this.macro = choice?.macro;
		this.choiceExecutor = choiceExecutor;
		this.params = {
			app: this.app,
			quickAddApi: QuickAddApi.GetApi(app, plugin, choiceExecutor),
			variables: {},
			obsidian,
			abort: (message?: string) => {
				throw new MacroAbortError(message);
			},
		};

		variables?.forEach((value, key) => {
			this.params.variables[key] = value;
		});
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
				if (command?.type === CommandType.Obsidian)
					this.executeObsidianCommand(command as IObsidianCommand);
				if (command?.type === CommandType.UserScript)
					await this.executeUserScript(command as IUserScript);
				if (command?.type === CommandType.Choice)
					await this.executeChoice(command as IChoiceCommand);
				if (command?.type === CommandType.Wait) {
					const waitCommand: IWaitCommand = command as IWaitCommand;
					await waitFor(waitCommand.time);
				}
				if (command?.type === CommandType.NestedChoice) {
					await this.executeNestedChoice(command as INestedChoiceCommand);
				}
				if (command?.type === CommandType.EditorCommand) {
					await this.executeEditorCommand(command as IEditorCommand);
				}
				if (command?.type === CommandType.AIAssistant) {
					await this.executeAIAssistant(command as IAIAssistantCommand);
				}
				if (command?.type === CommandType.OpenFile) {
					await this.executeOpenFile(command as IOpenFileCommand);
				}

				Object.keys(this.params.variables).forEach((key) => {
					this.choiceExecutor.variables.set(
						key,
						this.params.variables[key]
					);
				});
			}
		} catch (error) {
			if (error instanceof MacroAbortError) {
				log.logMessage(`Macro execution aborted: ${error.message}`);
				return;
			}
			throw error;
		}
	}

	// Slightly modified from Templater's user script engine:
	// https://github.com/SilentVoid13/Templater/blob/master/src/UserTemplates/UserTemplateParser.ts
	protected async executeUserScript(command: IUserScript) {
		const userScript = await getUserScript(command, this.app);
		if (!userScript) {
			log.logError(`failed to load user script ${command.path}.`);
			return;
		}

		// @ts-ignore
		if (userScript.settings) {
			this.userScriptCommand = command;
		}

		try {
			await this.userScriptDelegator(userScript);
		} catch (err) {
			if (err instanceof MacroAbortError) {
				throw err;
			}
			// Report and re-throw script errors so users can debug them
			reportError(err, `Failed to run user script ${command.name}`);
			throw err;
		}

		if (this.userScriptCommand) this.userScriptCommand = null;
	}

	private async runScriptWithSettings(
		userScript:
			| ((
					params: typeof this.params,
					settings: Record<string, unknown>
			  ) => Promise<void>)
			| {
					entry: (
						params: typeof this.params,
						settings: Record<string, unknown>
					) => Promise<void>;
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
				command.settings
			);
		}

		if (typeof userScript === "function") {
			return await this.onExportIsFunction(userScript, command.settings);
		}
	}

	 
	protected async userScriptDelegator(userScript: any) {
		switch (typeof userScript) {
			case "function":
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
				 
				await this.onExportIsObject(userScript);
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

		if (this.userScriptCommand && obj.entry !== null) {
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

		try {
			const keys = Object.keys(obj);
			const selected: string = await GenericSuggester.Suggest(
				this.app,
				keys,
				keys
			);

			await this.userScriptDelegator(obj[selected]);
		} catch (err) {
			if (err instanceof MacroAbortError) {
				throw err;
			}
			if (isCancellationError(err)) {
				throw new MacroAbortError("Input cancelled by user");
			}
			throw err;
		}
	}

	protected executeObsidianCommand(command: IObsidianCommand) {
		// @ts-ignore
		 
		this.app.commands.executeCommandById(command.commandId);
	}

	protected async executeChoice(command: IChoiceCommand) {
		const targetChoice: IChoice = this.plugin.getChoiceById(
			command.choiceId
		);
		if (!targetChoice) {
			log.logError("choice could not be found.");
			return;
		}

		await this.choiceExecutor.execute(targetChoice);
	}

	private async executeNestedChoice(command: INestedChoiceCommand) {
		const choice: IChoice = command.choice;
		if (!choice) {
			log.logError(`choice in ${command.name} is invalid`);
			return;
		}

		await this.choiceExecutor.execute(choice);
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
		}
	}

	private async executeAIAssistant(command: IAIAssistantCommand) {
		if (settingsStore.getState().disableOnlineFeatures) {
			throw new Error(
				"Blocking request to OpenAI: Online features are disabled in settings."
			);
		}

		const aiSettings = settingsStore.getState().ai;

		const options = getModelNames();
		let modelName: string;
		if (command.model === "Ask me") {
			try {
				modelName = await GenericSuggester.Suggest(this.app, options, options);
			} catch (error) {
				if (isCancellationError(error)) {
					throw new MacroAbortError("Input cancelled by user");
				}
				throw error;
			}
		} else {
			modelName = command.model;
		}

		const model: Model | undefined = getModelByName(modelName);

		if (!model) {
			throw new Error(`Model ${modelName} not found with any provider.`);
		}

		const formatter = new CompleteFormatter(
			this.app,
			QuickAdd.instance,
			this.choiceExecutor
		);

		const modelProvider = getModelProvider(model.name);

		if (!modelProvider) {
			throw new Error(
				`Model ${model.name} not found in the AI providers settings.`
			);
		}

		const aiOutputVariables = await runAIAssistant(
			this.app,
			{
				apiKey: modelProvider.apiKey,
				model,
				outputVariableName: command.outputVariableName,
				promptTemplate: command.promptTemplate,
				promptTemplateFolder: aiSettings.promptTemplatesFolderPath,
				systemPrompt: command.systemPrompt,
				showAssistantMessages: aiSettings.showAssistant,
				modelOptions: command.modelParameters,
			},
			async (input: string) => {
				return formatter.formatFileContent(input);
			}
		);

		for (const key in aiOutputVariables) {
			this.choiceExecutor.variables.set(key, aiOutputVariables[key]);
		}
	}

	private async executeOpenFile(command: IOpenFileCommand) {
		try {
			const formatter = new CompleteFormatter(
				this.app,
				QuickAdd.instance,
				this.choiceExecutor
			);

			const resolvedPath = await formatter.formatFileName(command.filePath, "");
			const normalizedPath = resolvedPath.replace(/\\/g, "/");

			// Validate path to prevent traversal attacks
			const safePath = "/" + normalizedPath;
			if (safePath.includes("..") || safePath.includes("//")) {
				log.logError(`OpenFile: Path traversal not allowed in '${normalizedPath}'`);
				return;
			}

			const file = this.app.vault.getAbstractFileByPath(normalizedPath);

			if (!file || !(file instanceof TFile)) {
				log.logError(`OpenFile: '${normalizedPath}' does not exist or is not a file`);
				return;
			}

			await openFile(this.app, file, {
				location: command.openInNewTab ? "split" : "tab",
				direction: command.direction === "horizontal" ? "horizontal" : "vertical",
				focus: true,
				mode: "default",
			});
		} catch (error) {
			log.logError(`OpenFile: Failed to open file '${command.filePath}': ${error.message}`);
		}
	}
}