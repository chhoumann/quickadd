import type { App } from "obsidian";
import type { IMacro } from "../types/macros/IMacro";
import { MacroChoiceEngine } from "./MacroChoiceEngine";
import type QuickAdd from "../main";
import type { IChoiceExecutor } from "../IChoiceExecutor";

export class StartupMacroEngine extends MacroChoiceEngine {
	constructor(
		app: App,
		plugin: QuickAdd,
		macros: IMacro[],
		choiceExecutor: IChoiceExecutor
	) {
		super(app, plugin, null!, macros, choiceExecutor, null!);
	}

	async run(): Promise<void> {
		this.macros.forEach((macro) => {
			if (macro.runOnStartup) {
				this.executeCommands(macro.commands);
			}
		});
	}
}
