import type IMacroChoice from "../types/choices/IMacroChoice";
import type { App } from "obsidian";
import * as obsidian from "obsidian";
import type { IUserScript } from "../types/macros/IUserScript";
import type { IObsidianCommand } from "../types/macros/IObsidianCommand";
import { log } from "../logger/logManager";
import { CommandType } from "../types/macros/CommandType";
import { QuickAddApi } from "../quickAddApi";
import type { ICommand } from "../types/macros/ICommand";
import { QuickAddChoiceEngine } from "./QuickAddChoiceEngine";
import type { IMacro } from "../types/macros/IMacro";
import GenericSuggester from "../gui/GenericSuggester/genericSuggester";
import type { IChoiceCommand } from "../types/macros/IChoiceCommand";
import type QuickAdd from "../main";
import type { IChoiceExecutor } from "../IChoiceExecutor";
import { getUserScript  } from "../utilityObsidian";
import type { IWaitCommand } from "../types/macros/QuickCommands/IWaitCommand";
import type { INestedChoiceCommand } from "../types/macros/QuickCommands/INestedChoiceCommand";
import type IChoice from "../types/choices/IChoice";
import type { IEditorCommand } from "../types/macros/EditorCommands/IEditorCommand";
import { EditorCommandType } from "../types/macros/EditorCommands/EditorCommandType";
import { CutCommand } from "../types/macros/EditorCommands/CutCommand";
import { CopyCommand } from "../types/macros/EditorCommands/CopyCommand";
import { PasteCommand } from "../types/macros/EditorCommands/PasteCommand";
import { SelectActiveLineCommand } from "../types/macros/EditorCommands/SelectActiveLineCommand";
import { SelectLinkOnActiveLineCommand } from "../types/macros/EditorCommands/SelectLinkOnActiveLineCommand";
import { waitFor } from "src/utility";

export class MacroChoiceEngine extends QuickAddChoiceEngine {
	public choice: IMacroChoice;
	public params: {
		app: App;
		quickAddApi: QuickAddApi;
		variables: Record<string, unknown>;
		obsidian: typeof obsidian;
	};
	protected output: unknown;
	protected macros: IMacro[];
	protected choiceExecutor: IChoiceExecutor;
	protected readonly plugin: QuickAdd;
	private userScriptCommand: IUserScript | null;

	constructor(
		app: App,
		plugin: QuickAdd,
		choice: IMacroChoice,
		macros: IMacro[],
		choiceExecutor: IChoiceExecutor,
		variables: Map<string, unknown>
	) {
		super(app);
		this.choice = choice;
		this.plugin = plugin;
		this.macros = macros;
		this.choiceExecutor = choiceExecutor;
		this.params = {
			app: this.app,
			quickAddApi: QuickAddApi.GetApi(app, plugin, choiceExecutor),
			variables: {},
			obsidian,
		};

		variables?.forEach((value, key) => {
			this.params.variables[key] = value;
		});
	}

	async run(): Promise<void> {
		const macroId: string = this.choice.macroId ?? this.choice?.macro?.id;
		const macro = this.macros.find((m) => m.id === macroId);

		if (!macro || !macro?.commands) {
			log.logError(
				`No commands in the selected macro. Did you select a macro for '${this.choice.name}'?`
			);
			return;
		}

		await this.executeCommands(macro.commands);
	}

	protected async executeCommands(commands: ICommand[]) {
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

			Object.keys(this.params.variables).forEach((key) => {
				this.choiceExecutor.variables.set(
					key,
					this.params.variables[key]
				);
			});
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
		} catch (error) {
			log.logError(
				`failed to run user script ${command.name}. Error:\n\n${(error as {message: string}).message}`
			);
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

	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	protected async userScriptDelegator(userScript: any) {
		switch (typeof userScript) {
			case "function":
				if (this.userScriptCommand) {
					await this.runScriptWithSettings(
						// eslint-disable-next-line @typescript-eslint/no-unsafe-argument
						userScript,
						this.userScriptCommand
					);
				} else {
					// eslint-disable-next-line @typescript-eslint/no-unsafe-argument
					await this.onExportIsFunction(userScript);
				}
				break;
			case "object":
				// eslint-disable-next-line @typescript-eslint/no-unsafe-argument
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
		} catch (e) {
			log.logMessage(e as string);
		}
	}

	protected executeObsidianCommand(command: IObsidianCommand) {
		// @ts-ignore
		// eslint-disable-next-line @typescript-eslint/no-unsafe-call
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
			case EditorCommandType.SelectActiveLine:
				SelectActiveLineCommand.run(this.app);
				break;
			case EditorCommandType.SelectLinkOnActiveLine:
				SelectLinkOnActiveLineCommand.run(this.app);
				break;
		}
	}
}
