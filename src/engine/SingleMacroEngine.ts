import type { App } from "obsidian";
import type { IChoiceExecutor } from "../IChoiceExecutor";
import { log } from "../logger/logManager";
import type QuickAdd from "../main";
import type IChoice from "../types/choices/IChoice";
import type IMacroChoice from "../types/choices/IMacroChoice";
import type { IUserScript } from "../types/macros/IUserScript";
import { CommandType } from "../types/macros/CommandType";
import { getUserScript, getUserScriptMemberAccess } from "../utilityObsidian";
import { flattenChoices } from "../utils/choiceUtils";
import { initializeUserScriptSettings } from "../utils/userScriptSettings";
import { MacroChoiceEngine } from "./MacroChoiceEngine";

export class SingleMacroEngine {
	private readonly choiceExecutor: IChoiceExecutor;
	private readonly variables: Map<string, unknown>;

	constructor(
		private readonly app: App,
		private readonly plugin: QuickAdd,
		private readonly choices: IChoice[],
		choiceExecutor: IChoiceExecutor,
		variables?: Map<string, unknown>,
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
				choice.type === "Macro" && trimmed(choice.name) === trimmed(basename),
		);

		// ------------------------------------------------------------------
		// Step 2 – fallback to case-insensitive lookup for user convenience.
		// If this yields *multiple* matches we abort to prevent ambiguity.
		// ------------------------------------------------------------------
		if (!macroChoice) {
			const lower = (s: string | undefined) => trimmed(s).toLowerCase();
			const ciMatches = flattenChoices(this.choices).filter(
				(choice): choice is IMacroChoice =>
					choice.type === "Macro" && lower(choice.name) === lower(basename),
			);

			if (ciMatches.length > 1) {
				log.logError(
					`Ambiguous macro reference '${macroName}'. Multiple choices match when ignoring case.`,
				);
				throw new Error(
					`Ambiguous macro reference '${macroName}'. Please disambiguate by renaming macros.`,
				);
			}

			macroChoice = ciMatches[0];
		}

		if (!macroChoice) {
			log.logError(`macro '${macroName}' does not exist.`);
			throw new Error(`macro '${macroName}' does not exist.`);
		}

		const preloadedScripts = new Map<string, unknown>();

		// Create a dedicated engine for this macro
		const engine = new MacroChoiceEngine(
			this.app,
			this.plugin,
			macroChoice,
			this.choiceExecutor,
			this.variables,
			preloadedScripts,
		);

		if (memberAccess?.length) {
			const exportAttempt = await this.tryExecuteExport(
				engine,
				macroChoice,
				memberAccess,
				preloadedScripts,
			);

			if (exportAttempt.executed) {
				return this.formatResult(exportAttempt.result);
			}
		}

		// Always execute the whole macro first
		await engine.run();
		let result: unknown = engine.getOutput();

		// Apply member access afterwards (if requested)
		if (memberAccess?.length) {
			result = this.applyMemberAccess(result, memberAccess);
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

	private async tryExecuteExport(
		engine: MacroChoiceEngine,
		macroChoice: IMacroChoice,
		memberAccess: string[],
		preloadedScripts: Map<string, unknown>,
	): Promise<{ executed: boolean; result?: unknown }> {
		const commands = macroChoice.macro?.commands;
		if (!commands?.length) {
			return { executed: false };
		}

		const userScriptCommandIndex = commands.findIndex(
			(command) => command.type === CommandType.UserScript,
		);

		if (userScriptCommandIndex === -1) {
			return { executed: false };
		}

		const userScriptCandidate = commands[userScriptCommandIndex];
		if (userScriptCandidate.type !== CommandType.UserScript) {
			return { executed: false };
		}
		const userScriptCommand = userScriptCandidate as IUserScript;

		if (!userScriptCommand.settings) {
			userScriptCommand.settings = {};
		}

		const exportsRef = await getUserScript(userScriptCommand, this.app);

		if (exportsRef === undefined || exportsRef === null) {
			return { executed: false };
		}

		const cacheKey = userScriptCommand.path ?? userScriptCommand.id;
		if (cacheKey) {
			preloadedScripts.set(cacheKey, exportsRef);
		}

		const settingsExport =
			typeof exportsRef === "object" || typeof exportsRef === "function"
				? (exportsRef as Record<string, unknown>).settings
				: undefined;

		if (settingsExport && typeof settingsExport === "object") {
			initializeUserScriptSettings(
				userScriptCommand.settings,
				settingsExport as Record<string, unknown>,
			);
		}

		const resolvedMember = this.resolveMemberAccess(
			exportsRef,
			memberAccess,
		);

		if (!resolvedMember.found) {
			return { executed: false };
		}

		const preCommands = commands.slice(0, userScriptCommandIndex);
		if (preCommands.length) {
			await engine.runSubset(preCommands);
		}

		const result = await this.executeResolvedMember(
			resolvedMember.value,
			engine,
			userScriptCommand.settings,
		);

		engine.setOutput(result);
		this.syncVariablesFromParams(engine);

		const postCommands = commands.slice(userScriptCommandIndex + 1);
		if (postCommands.length) {
			await engine.runSubset(postCommands);
		}

		return {
			executed: true,
			result,
		};
	}

	private resolveMemberAccess(
		moduleExports: unknown,
		memberAccess: string[],
	): { found: boolean; value?: unknown } {
		let current: unknown = moduleExports;

		for (const key of memberAccess) {
			if (
				current === undefined ||
				current === null ||
				(typeof current !== "object" && typeof current !== "function")
			) {
				return { found: false };
			}

			const container = current as Record<string, unknown>;

			if (!(key in container)) {
				return { found: false };
			}

			current = container[key];
		}

		return {
			found: true,
			value: current,
		};
	}

	private async executeResolvedMember(
		member: unknown,
		engine: MacroChoiceEngine,
		settings: Record<string, unknown>,
	): Promise<unknown> {
		// Ensure params reflect latest shared variables before executing
		this.choiceExecutor.variables.forEach((value, key) => {
			engine.params.variables[key] = value;
		});

		if (typeof member === "function") {
			return await (
				member as (
					params: unknown,
					settings: Record<string, unknown>,
				) => unknown
			)(engine.params, settings);
		}

		return member;
	}

	private applyMemberAccess(
		result: unknown,
		memberAccess: string[],
	): unknown {
		let current = result;

		for (const key of memberAccess) {
			if (
				current === undefined ||
				current === null ||
				(typeof current !== "object" && typeof current !== "function")
			) {
				return undefined;
			}

			const container = current as Record<string, unknown>;

			if (!(key in container)) {
				return undefined;
			}

			current = container[key];
		}

		return current;
	}

	private syncVariablesFromParams(engine: MacroChoiceEngine) {
		Object.keys(engine.params.variables).forEach((key) => {
			this.choiceExecutor.variables.set(
				key,
				engine.params.variables[key],
			);
		});
	}

	private formatResult(result: unknown): string {
		if (result === undefined || result === null) {
			return "";
		}

		if (typeof result === "string") {
			return result;
		}

		if (
			typeof result === "number" ||
			typeof result === "boolean" ||
			typeof result === "bigint"
		) {
			return result.toString();
		}

		if (typeof result === "object") {
			try {
				return JSON.stringify(result);
			} catch {
				return Object.prototype.toString.call(result);
			}
		}

		return String(result);
	}
}
