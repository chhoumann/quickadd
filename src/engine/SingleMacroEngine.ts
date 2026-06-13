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

// Member names that QuickAdd itself treats as conventions rather than entrypoints
// (`settings` is consumed by initializeUserScriptSettings; `entry` is the object-export
// entrypoint handled by MacroChoiceEngine). They are exported by many scripts, so a
// `{{MACRO:Name::settings}}` reference must keep resolving (first-declared exporter wins,
// as it did before 2.12.1) instead of hard-aborting on a conflict like a real entrypoint.
const RESERVED_CONVENTION_KEYS = new Set<string>(["settings", "entry"]);

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

// `unknown` already subsumes `Promise<unknown>`; the callable may be sync or async
// and its result is awaited at the call site either way.
type UserScriptCallable = () => unknown;

function formatMacroOutput(value: unknown): string {
	if (value === null || value === undefined) return "";
	if (typeof value === "string") return value;
	if (typeof value === "number" || typeof value === "boolean") {
		return String(value);
	}
	if (typeof value === "bigint" || typeof value === "symbol") {
		return value.toString();
	}
	if (value instanceof Error) return value.message;

	try {
		return JSON.stringify(value);
	} catch {
		return Object.prototype.toString.call(value);
	}
}

export class SingleMacroEngine {
	private readonly choiceExecutor: IChoiceExecutor;
	private readonly variables: Map<string, unknown>;
	// Guards the reserved-key conflict notice so a single macro run surfaces it at most once.
	private emittedConflictNotice = false;

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
		this.emittedConflictNotice = false;
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

		// Apply member access afterwards (if requested). Reaching this fallback with a
		// member path means tryExecuteExport returned executed:false, i.e. the macro has
		// no user-script command that could provide the member — so a failed lookup would
		// otherwise resolve to an empty string silently. Warn instead of guessing.
		if (memberAccess?.length) {
			const resolved = this.applyMemberAccess(result, memberAccess);
			if (resolved === undefined) {
				log.logWarning(
					`Macro '${macroChoice.name}' was asked for member '${memberAccess.join(
						"::",
					)}', but it has no user script exporting it; the result is empty.`,
				);
			}
			result = resolved;
		}

		// Handle functions and objects properly
		if (typeof result === "function") {
			result = await (result as UserScriptCallable)();
		} else if (result && typeof result === "object") {
			result = JSON.stringify(result);
		}

		return formatMacroOutput(result);
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
		const candidateId = selection.candidate.command.id;
		const preCommands = originalCommands.slice(0, selection.candidate.index);

		try {
			if (preCommands.length) {
				await engine.runSubset(preCommands);
				this.ensureNotAborted();
			}

			const updatedCommands = macroChoice.macro?.commands ?? originalCommands;
			// Pre-commands may have mutated the commands array, so re-resolve the selected
			// command by its stable id. Both the candidate and the post-command slice are
			// derived from this refreshed index so they cannot drift apart. The original
			// positional index is only a fallback for legacy commands that genuinely have
			// no id; if the command HAD an id but it is now gone (removed mid-run), leave
			// the index unresolved so the guard below aborts rather than silently routing
			// to a neighbouring script.
			let refreshedIndex: number;
			if (candidateId !== undefined) {
				refreshedIndex = updatedCommands.findIndex(
					(command) =>
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

		// Convention keys (settings/entry) are exported by many scripts and were resolved
		// against the first script before 2.12.1. Preserve that — pick the first-declared
		// exporter (matchingCandidates preserves command order) and surface a one-time
		// notice pointing at the selector — rather than hard-aborting like a real entrypoint.
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
