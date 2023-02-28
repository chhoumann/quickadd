import type { App } from "obsidian";
import type { IMacro } from "../types/macros/IMacro";
import { MacroChoiceEngine } from "./MacroChoiceEngine";
import type QuickAdd from "../main";
import type { IChoiceExecutor } from "../IChoiceExecutor";
import { getUserScriptMemberAccess } from "../utility";
import { log } from "../logger/logManager";

export class SingleMacroEngine extends MacroChoiceEngine {
	private memberAccess: string[];

	constructor(
		app: App,
		plugin: QuickAdd,
		macros: IMacro[],
		choiceExecutor: IChoiceExecutor,
		variables: Map<string, unknown>
	) {
		// eslint-disable-next-line @typescript-eslint/no-non-null-assertion
		super(app, plugin, null!, macros, choiceExecutor, variables);
	}

	public async runAndGetOutput(macroName: string): Promise<string> {
		const { basename, memberAccess } = getUserScriptMemberAccess(macroName);
		const macro = this.macros.find((macro) => macro.name === basename);
		if (!macro) {
			log.logError(`macro '${macroName}' does not exist.`);
			throw new Error(`macro '${macroName}' does not exist.`);
		}

		if (memberAccess && memberAccess.length > 0) {
			this.memberAccess = memberAccess;
		}

		await this.executeCommands(macro.commands);
		return this.output as string;
	}

	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	protected override async onExportIsObject(obj: any): Promise<void> {
		if (!this.memberAccess) return await super.onExportIsObject(obj);
		let newObj = obj;
		this.memberAccess.forEach((key) => {
			newObj = newObj[key];
		});

		await this.userScriptDelegator(newObj);
	}
}
