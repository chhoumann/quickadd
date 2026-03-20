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
import { handleMacroAbort } from "../utils/macroAbortHandler";
import { MacroAbortError } from "../errors/MacroAbortError";

type UserScriptCandidate = {
	command: IUserScript;
	index: number;
	exportsRef?: unknown;
	resolvedMember?: { found: boolean; value?: unknown };
};

type MemberAccessSelection = {
	candidate: UserScriptCandidate;
	memberAccess: string[];
};

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

	public async runAndGetOutput(
		macroName: string,
		context?: { label?: string },
	): Promise<string> {
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

		// Create a dedicated engine for this macro
		const engine = new MacroChoiceEngine(
			this.app,
			this.plugin,
			macroChoice,
			this.choiceExecutor,
			this.variables,
			undefined,
			context?.label,
		);

		if (memberAccess?.length) {
			const exportAttempt = await this.tryExecuteExport(
				engine,
				macroChoice,
				memberAccess,
			);

			this.ensureNotAborted();

			if (exportAttempt.executed) {
				return this.formatResult(exportAttempt.result);
			}
		}

		// Always execute the whole macro first
		await engine.run();
		this.ensureNotAborted();
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
	): Promise<{ executed: boolean; result?: unknown }> {
		const originalCommands = macroChoice.macro?.commands;
		if (!originalCommands?.length) {
			return { executed: false };
		}

		const userScriptCommands = originalCommands
			.map((command, index) => ({ command, index }))
			.filter(
				(entry): entry is { command: IUserScript; index: number } =>
					entry.command.type === CommandType.UserScript,
			);

		if (userScriptCommands.length === 0) {
			return { executed: false };
		}

		const selection = await this.selectUserScriptCandidate(
			macroChoice,
			userScriptCommands,
			memberAccess,
		);
		const preCommands = originalCommands.slice(0, selection.candidate.index);

		try {
			if (preCommands.length) {
				await engine.runSubset(preCommands);
				this.ensureNotAborted();
			}

			const updatedCommands = macroChoice.macro?.commands ?? originalCommands;
			const refreshedCandidate = updatedCommands[selection.candidate.index];
			if (!refreshedCandidate || refreshedCandidate.type !== CommandType.UserScript) {
				throw new MacroAbortError(
					`Could not resolve the member-access script for '${macroChoice.name}'.`,
				);
			}
			const userScriptCommand = refreshedCandidate as IUserScript;

			if (!userScriptCommand.settings) {
				userScriptCommand.settings = {};
			}

			const exportsRef =
				selection.candidate.exportsRef !== undefined
					? selection.candidate.exportsRef
					: await getUserScript(userScriptCommand, this.app);

			if (exportsRef === undefined || exportsRef === null) {
				throw new MacroAbortError(
					`Macro '${macroChoice.name}' could not load '${userScriptCommand.name}' for member access.`,
				);
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

			const resolvedMember =
				selection.candidate.resolvedMember ??
				this.resolveMemberAccess(exportsRef, selection.memberAccess);

			if (!resolvedMember.found) {
				throw new MacroAbortError(
					`Macro '${macroChoice.name}' routes member access to '${userScriptCommand.name}', but that script does not export '${selection.memberAccess.join(
						"::",
					)}'.`,
				);
			}

			const postCommands = updatedCommands.slice(selection.candidate.index + 1);

			const result = await this.executeResolvedMember(
				resolvedMember.value,
				engine,
				userScriptCommand.settings,
			);
			this.ensureNotAborted();

			engine.setOutput(result);
			this.syncVariablesFromParams(engine);

			if (postCommands.length) {
				await engine.runSubset(postCommands);
				this.ensureNotAborted();
			}

			return {
				executed: true,
				result,
			};
		} catch (error) {
			if (
				handleMacroAbort(error, {
					logPrefix: "Macro execution aborted",
					noticePrefix: "Macro execution aborted",
					defaultReason: "Macro execution aborted",
				})
			) {
				this.choiceExecutor.signalAbort?.(error as MacroAbortError);
				throw error;
			}
			throw error;
		}
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

	private async selectUserScriptCandidate(
		macroChoice: IMacroChoice,
		userScriptCommands: Array<{ command: IUserScript; index: number }>,
		memberAccess: string[],
	): Promise<MemberAccessSelection> {
		if (userScriptCommands.length === 1) {
			return {
				candidate: {
					command: userScriptCommands[0].command,
					index: userScriptCommands[0].index,
				},
				memberAccess,
			};
		}

		const selectorMatch = this.resolveScriptSelector(
			macroChoice,
			userScriptCommands,
			memberAccess,
		);

		if (selectorMatch) {
			return {
				candidate: {
					command: selectorMatch.command,
					index: selectorMatch.index,
				},
				memberAccess: selectorMatch.memberAccess,
			};
		}

		const candidates: Array<
			UserScriptCandidate & { resolvedMember: { found: boolean; value?: unknown } }
		> = [];

		for (const entry of userScriptCommands) {
			const exportsRef = await getUserScript(entry.command, this.app);
			candidates.push({
				command: entry.command,
				index: entry.index,
				exportsRef,
				resolvedMember: this.resolveMemberAccess(exportsRef, memberAccess),
			});
		}

		const matchingCandidates = candidates.filter(
			(candidate) => candidate.resolvedMember.found,
		);

		if (matchingCandidates.length === 1) {
			return {
				candidate: matchingCandidates[0],
				memberAccess,
			};
		}

		if (matchingCandidates.length === 0) {
			throw new MacroAbortError(
				`Macro '${macroChoice.name}' could not find '${memberAccess.join(
					"::",
				)}' in any user script.`,
			);
		}

		const matchingNames = matchingCandidates
			.map((candidate) => `'${candidate.command.name}'`)
			.join(", ");

		throw new MacroAbortError(
			`Macro '${macroChoice.name}' has multiple user scripts exporting '${memberAccess.join(
				"::",
			)}': ${matchingNames}. Disambiguate with '{{MACRO:${macroChoice.name}::<Script Name>::${memberAccess.join(
				"::",
			)}}}'.`,
		);
	}

	private resolveScriptSelector(
		macroChoice: IMacroChoice,
		userScriptCommands: Array<{ command: IUserScript; index: number }>,
		memberAccess: string[],
	): { command: IUserScript; index: number; memberAccess: string[] } | null {
		if (memberAccess.length < 2) {
			return null;
		}

		const selectorName = memberAccess[0]?.trim();
		const matchingScripts = userScriptCommands.filter(
			(candidate) => candidate.command.name.trim() === selectorName,
		);

		if (matchingScripts.length === 0) {
			return null;
		}

		if (matchingScripts.length > 1) {
			throw new MacroAbortError(
				`Macro '${macroChoice.name}' has multiple user scripts named '${selectorName}'. Rename one of them before using '{{MACRO:${macroChoice.name}::${selectorName}::${memberAccess
					.slice(1)
					.join("::")}}}'.`,
			);
		}

		return {
			command: matchingScripts[0].command,
			index: matchingScripts[0].index,
			memberAccess: memberAccess.slice(1),
		};
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

	private ensureNotAborted() {
		const abort = this.choiceExecutor.consumeAbortSignal?.();
		if (abort) {
			throw abort;
		}
	}
}
