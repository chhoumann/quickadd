import type { App } from "obsidian";
import type { IChoiceExecutor } from "../IChoiceExecutor";
import { log } from "../logger/logManager";
import type QuickAdd from "../main";
import type IChoice from "../types/choices/IChoice";
import type IMacroChoice from "../types/choices/IMacroChoice";
import { getUserScriptMemberAccess } from "../utilityObsidian";
import { flattenChoices } from "../utils/choiceUtils";
import { MacroChoiceEngine } from "./MacroChoiceEngine";

export class SingleMacroEngine {
	private readonly choiceExecutor: IChoiceExecutor;
	private readonly variables: Map<string, unknown>;

	constructor(
		private readonly app: App,
		private readonly plugin: QuickAdd,
		private readonly choices: IChoice[],
		choiceExecutor: IChoiceExecutor,
		variables?: Map<string, unknown>
	) {
		this.choiceExecutor = choiceExecutor;

		// Decide which Map instance to use
		if (variables) {
			// Caller supplied its own map – use it everywhere
			this.variables = variables;
			this.choiceExecutor.variables = variables;
		} else if (choiceExecutor.variables) {
			// Re-use executor's existing map
			this.variables = choiceExecutor.variables;
		} else {
			// Nothing passed in – create a fresh map and share it
			this.variables = new Map<string, unknown>();
			this.choiceExecutor.variables = this.variables;
		}
	}

	public async runAndGetOutput(macroName: string): Promise<string> {
		const { basename, memberAccess } = getUserScriptMemberAccess(macroName);

		// ------------------------------------------------------------------
		// Step 1 – exact match (case-sensitive) on *trimmed* names.
		// This preserves historical behaviour where two macros differing
		// only by case are treated as distinct entities.
		// ------------------------------------------------------------------
		const trimmed = (s: string | undefined) => (s ?? "").trim();
		let macroChoice = flattenChoices(this.choices).find(
			(choice): choice is IMacroChoice =>
				choice.type === "Macro" && trimmed(choice.name) === trimmed(basename)
		);

		// ------------------------------------------------------------------
		// Step 2 – fallback to case-insensitive lookup for user convenience.
		// If this yields *multiple* matches we abort to prevent ambiguity.
		// ------------------------------------------------------------------
		if (!macroChoice) {
			const lower = (s: string | undefined) => trimmed(s).toLowerCase();
			const ciMatches = flattenChoices(this.choices).filter(
				(choice): choice is IMacroChoice =>
					choice.type === "Macro" && lower(choice.name) === lower(basename)
			);

			if (ciMatches.length > 1) {
				log.logError(
					`Ambiguous macro reference '${macroName}'. Multiple choices match when ignoring case.`
				);
				throw new Error(
					`Ambiguous macro reference '${macroName}'. Please disambiguate by renaming macros.`
				);
			}

			macroChoice = ciMatches[0];
		}

		if (!macroChoice) {
			log.logError(`macro '${macroName}' does not exist.`);
			throw new Error(`macro '${macroName}' does not exist.`);
		}

		// Create a dedicated engine for this macro
		const engine = new MacroChoiceEngine(
			this.app,
			this.plugin,
			macroChoice,
			this.choiceExecutor,
			this.variables
		);

		// Always execute the whole macro first
		await engine.run();
		let result: unknown = engine.getOutput();

		// Apply member access afterwards (if requested)
		if (memberAccess?.length) {
			for (const key of memberAccess) {
				// @ts-expect-error – dynamic descent
				result = (result as any)?.[key];
			}
		}

		// Handle functions and objects properly
		if (typeof result === "function") {
			result = await (result as (...args: any[]) => any)();
		} else if (result && typeof result === "object") {
			result = JSON.stringify(result);
		}

		return (result ?? "").toString();
	}

	public getVariables(): Map<string, unknown> {
		return this.variables;
	}
}
