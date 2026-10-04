import type { App } from "obsidian";
import { MacroChoiceEngine } from "./MacroChoiceEngine";
import type QuickAdd from "../main";
import type { IChoiceExecutor } from "../IChoiceExecutor";
import type IChoice from "../types/choices/IChoice";
import type IMacroChoice from "../types/choices/IMacroChoice";
import { flattenChoices } from "../utils/choiceUtils";
import { reportError } from "../utils/errorUtils";

export class StartupMacroEngine {
	constructor(
		private app: App,
		private plugin: QuickAdd,
		private choices: IChoice[],
		private choiceExecutor: IChoiceExecutor
	) {}

	async run(): Promise<void> {
		const macroChoices = flattenChoices(this.choices)
			.filter((c): c is IMacroChoice => c.type === "Macro" && (c as IMacroChoice).runOnStartup);
		
		for (const choice of macroChoices) {
			// Isolate each startup macro: one that throws (a script bug, missing
			// dependency, etc.) must not stop the rest from running. Report the
			// failure naming the macro and continue to the next one.
			try {
				await new MacroChoiceEngine(
					this.app,
					this.plugin,
					choice,
					this.choiceExecutor,
					new Map()
				).run();
			} catch (error) {
				reportError(
					error,
					`Startup macro '${choice.name}' failed`
				);
			}
		}
	}
}
