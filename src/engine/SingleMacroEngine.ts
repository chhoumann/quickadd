import type { App } from "obsidian";
import type { IChoiceExecutor } from "../IChoiceExecutor";
import { log } from "../logger/logManager";
import type { ChoiceRuntimePlugin } from "../types/pluginContext";
import type { FormatterExecutionRuntime } from "../formatters/formatterRuntime";
import type IChoice from "../types/choices/IChoice";
import type IMacroChoice from "../types/choices/IMacroChoice";
import type { IUserScript } from "../types/macros/IUserScript";
import { CommandType } from "../types/macros/CommandType";
import { getUserScript, getUserScriptMemberAccess } from "../utils/userScript";
import { flattenChoices } from "../utils/choiceUtils";
import { initializeUserScriptSettings } from "../utils/userScriptSettings";
import { resolveScriptSettings } from "./userScriptSettings";
import { MacroChoiceEngine } from "./MacroChoiceEngine";
import { enterChoice, type ChoiceChain } from "./choiceChain";
import { handleMacroAbort } from "../utils/macroAbortHandler";
import {
	commandListOf,
	hasCommandList,
	isCommandLike,
} from "../utils/macroUtils";
import { MacroAbortError } from "../errors/MacroAbortError";

// Members QuickAdd reads as conventions, not entrypoints. Many scripts export
// them, so `{{MACRO:Name::settings}}` resolves to the first exporter instead of
// aborting on the conflict.
const RESERVED_CONVENTION_KEYS = new Set<string>([
	"settings",
	"entry",
	"quickadd",
]);

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

type UserScriptCallable = () => unknown;

/**
 * The text a macro's result puts in the note. An Error gives its message, and
 * an object that JSON cannot hold (a circular one) gives its type tag rather
 * than failing the run.
 */
function formatMacroOutput(value: unknown): string {
	if (value === null || value === undefined) return "";
	if (typeof value === "string") return value;
	if (value instanceof Error) return value.message;
	if (typeof value === "object") {
		try {
			return JSON.stringify(value) ?? "";
		} catch {
			return Object.prototype.toString.call(value);
		}
	}
	return String(value);
}

export class SingleMacroEngine {
	private readonly choiceExecutor: IChoiceExecutor;
	private readonly variables: Map<string, unknown>;
	private emittedConflictNotice = false;

	constructor(
		private readonly app: App,
		private readonly plugin: ChoiceRuntimePlugin,
		private readonly runtime: FormatterExecutionRuntime,
		private readonly choices: IChoice[],
		choiceExecutor: IChoiceExecutor,
		variables?: Map<string, unknown>,
	) {
		this.choiceExecutor = choiceExecutor;

		if (variables) {
			this.variables = variables;
			this.choiceExecutor.variables = variables;
		} else if (choiceExecutor.variables) {
			this.variables = choiceExecutor.variables;
		} else {
			this.variables = new Map<string, unknown>();
			this.choiceExecutor.variables = this.variables;
		}
	}

	public async runAndGetOutput(
		macroName: string,
		context?: { label?: string },
		ancestry: ChoiceChain = [],
	): Promise<string> {
		this.emittedConflictNotice = false;
		const { basename, memberAccess } = getUserScriptMemberAccess(macroName);

		// Exact, case-sensitive match on trimmed names first, so macros differing
		// only by case stay distinct.
		const trimmed = (s: string | undefined) => (s ?? "").trim();
		let macroChoice = flattenChoices(this.choices).find(
			(choice): choice is IMacroChoice =>
				choice.type === "Macro" && trimmed(choice.name) === trimmed(basename),
		);

		// Then a case-insensitive fallback, aborting when it is ambiguous.
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

		const engine = new MacroChoiceEngine(
			this.app,
			this.plugin,
			this.runtime,
			macroChoice,
			this.choiceExecutor,
			this.variables,
			undefined,
			context?.label,
			null,
			enterChoice(macroChoice, ancestry),
		);

		if (memberAccess?.length) {
			const exportAttempt = await this.tryExecuteExport(
				engine,
				macroChoice,
				memberAccess,
			);

			this.ensureNotAborted();

			if (exportAttempt.executed) {
				return formatMacroOutput(exportAttempt.result);
			}
		}

		await engine.run();
		this.ensureNotAborted();
		let result: unknown = engine.getOutput();

		// Reaching this with a member path means no user-script command could
		// provide it, so warn instead of silently resolving to an empty string.
		if (memberAccess?.length) {
			// A member that exists but holds `undefined` is not missing.
			const lookup = this.resolveMemberAccess(result, memberAccess);
			if (!lookup.found) {
				log.logWarning(
					`Macro '${macroChoice.name}' was asked for member '${memberAccess.join(
						"::",
					)}', but it has no user script exporting it; the result is empty.`,
				);
			}
			result = lookup.value;
		}

		if (typeof result === "function") {
			result = await (result as UserScriptCallable)();
		}

		return formatMacroOutput(result);
	}

	private async tryExecuteExport(
		engine: MacroChoiceEngine,
		macroChoice: IMacroChoice,
		memberAccess: string[],
	): Promise<{ executed: boolean; result?: unknown }> {
		// commandListOf, not `?.length`: a string `commands` has a length too.
		const originalCommands = commandListOf(macroChoice.macro?.commands);
		if (!originalCommands.length) {
			return { executed: false };
		}

		const userScriptCommands = originalCommands
			.map((command, index) => ({ command, index }))
			.filter(
				(entry): entry is { command: IUserScript; index: number } =>
					// commandListOf normalizes non-array shapes only; a `null` hole
					// inside an array still needs isCommandLike.
					isCommandLike(entry.command) &&
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
		const candidateId = selection.candidate.command.id;
		const preCommands = originalCommands.slice(0, selection.candidate.index);

		try {
			if (preCommands.length) {
				await engine.runSubset(preCommands);
				this.ensureNotAborted();
			}

			// Fall back to the list we started from if a pre-command replaced
			// `commands` with something unreadable, rather than carrying that value
			// into the index arithmetic below.
			const refreshed = macroChoice.macro?.commands;
			const updatedCommands = hasCommandList(refreshed)
				? (refreshed)
				: originalCommands;
			// Pre-commands may have changed `commands`, so re-resolve the selected
			// command by id. A command that had an id but is gone leaves the index
			// unresolved, so the guard below aborts rather than running a neighbour.
			let refreshedIndex: number;
			if (candidateId !== undefined) {
				refreshedIndex = updatedCommands.findIndex(
					(command) =>
						// A pre-command can rewrite `commands` to include a hole; the
						// hasCommandList guard above only rejects a non-array refresh.
						isCommandLike(command) &&
						command.id === candidateId &&
						command.type === CommandType.UserScript,
				);
			} else {
				refreshedIndex = selection.candidate.index;
			}
			const refreshedCandidate =
				refreshedIndex >= 0 ? updatedCommands[refreshedIndex] : undefined;
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

			const postCommands = updatedCommands.slice(refreshedIndex + 1);
			let memberSettings = userScriptCommand.settings;
			if (typeof resolvedMember.value === "function") {
				memberSettings = await resolveScriptSettings(
					this.app, this.plugin, userScriptCommand,
					settingsExport && typeof settingsExport === "object"
						? (settingsExport) : undefined,
				);
			}

			const result = await this.executeResolvedMember(
				resolvedMember.value,
				engine,
				memberSettings,
			);
			this.ensureNotAborted();

			engine.setOutput(result);

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
				this.choiceExecutor.signalAbort?.(error);
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

		// Convention keys resolve to the first-declared exporter with a one-time
		// notice, rather than aborting like a real entrypoint.
		if (RESERVED_CONVENTION_KEYS.has(memberAccess[0])) {
			const chosen = matchingCandidates[0];
			this.warnReservedKeyConflict(
				macroChoice,
				memberAccess,
				chosen,
				matchingCandidates,
			);
			return { candidate: chosen, memberAccess };
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

	private warnReservedKeyConflict(
		macroChoice: IMacroChoice,
		memberAccess: string[],
		chosen: UserScriptCandidate,
		all: UserScriptCandidate[],
	): void {
		if (this.emittedConflictNotice) return;
		this.emittedConflictNotice = true;

		const names = all
			.map((candidate) => `'${candidate.command.name}'`)
			.join(", ");

		log.logWarning(
			`Macro '${macroChoice.name}': multiple user scripts export '${memberAccess.join(
				"::",
			)}' (${names}); using '${chosen.command.name}'. Disambiguate with '{{MACRO:${macroChoice.name}::<Script Name>::${memberAccess.join(
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

	private ensureNotAborted() {
		const abort = this.choiceExecutor.consumeAbortSignal?.();
		if (abort) {
			throw abort;
		}
	}
}
