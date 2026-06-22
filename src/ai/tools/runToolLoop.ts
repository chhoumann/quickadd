/**
 * Provider-agnostic agentic tool loop (#714). PURE — every Obsidian/provider touch
 * point is injected, so the loop is fully unit-testable with a fake `dispatch`.
 *
 * Per spec §7: dispatch → if tool calls, run each (one result PER call id) → append
 * assistant + tool-result turns → repeat until the model stops or the step budget is
 * hit. The LAST allowed step forces toolChoice:'none' so the run always lands on a
 * text answer with no orphaned tool_use. A handler throwing a hard-abort error
 * (MacroAbortError/UserCancelError) propagates out and kills the macro; any other
 * throw becomes an `isError` tool result the model can recover from. Caps bound cost
 * and exfiltration: a step ceiling, a per-result byte cap, and a cumulative
 * transcript-bytes ceiling (the real exfiltration metric).
 */
import type {
	NormalizedChatRequest,
	NormalizedMessage,
	NormalizedToolCall,
	NormalizedToolDefinition,
	NormalizedToolResult,
} from "./NormalizedTools";
import type { ParsedChatResult } from "./providerToolMapping";

export interface ToolEntry {
	definition: NormalizedToolDefinition;
	execute: (
		args: Record<string, unknown>,
		ctx: { toolCallId: string; toolName: string },
	) => unknown | Promise<unknown>;
	readOnly?: boolean;
}

export type LoopFinishReason =
	| "stop"
	| "length"
	| "max-steps"
	| "aborted"
	| "context-overflow";

export interface LoopStep {
	stepNumber: number;
	text: string;
	toolCalls: NormalizedToolCall[];
	toolResults: NormalizedToolResult[];
	finishReason: string;
	usage: ParsedChatResult["usage"];
}

export interface RunToolLoopResult {
	text: string;
	steps: LoopStep[];
	finishReason: LoopFinishReason;
	usage: { promptTokens: number; completionTokens: number; totalTokens: number };
	messages: NormalizedMessage[];
	/** The final dispatched turn (so the caller can parse structured output). */
	finalTurn: ParsedChatResult;
}

export interface RunToolLoopDeps {
	/** The initial request (messages already seeded with system + first user turn). */
	request: NormalizedChatRequest;
	/** Send one turn. `isFinalStep` lets the provider omit tools (Gemini+schema) / force no tool use. */
	dispatch: (
		req: NormalizedChatRequest,
		ctx: { isFinalStep: boolean },
	) => Promise<ParsedChatResult>;
	/** Look up a registered tool by name (returns undefined for an unknown tool). */
	getTool: (name: string) => ToolEntry | undefined;
	/**
	 * Decide + gate one call. Return true to run it, false to decline (→ isError
	 * result). THROW (MacroAbortError/UserCancelError) to abort the whole run.
	 */
	confirm: (call: NormalizedToolCall, tool: ToolEntry) => Promise<boolean>;
	/** Validate model args against the tool's schema; return an error string or null. */
	validateArgs: (tool: ToolEntry, args: Record<string, unknown>) => string | null;
	/** True if the error must propagate and kill the macro (abort/cancel). */
	isAbortError: (e: unknown) => boolean;
	/** True if a dispatch error is an input-context-window overflow (→ graceful stop). */
	isContextOverflow?: (e: unknown) => boolean;
	/** Re-checked at the top of every step after the first; true → graceful stop. */
	isOnlineDisabled?: () => boolean;
	/**
	 * Evaluated after each tool-execution step (backs AI-SDK `stopWhen`/`hasToolCall`).
	 * Returning true makes the NEXT step the forced-final text turn. The `maxSteps`
	 * hard clamp always applies on top of this.
	 */
	shouldStop?: (info: { steps: LoopStep[] }) => boolean;
	onStepFinish?: (step: LoopStep) => void | Promise<void>;
	maxSteps: number;
	/** Per-tool-result byte cap (truncate + marker). Default 32 KB. */
	maxResultBytes?: number;
	/** Cumulative transcript-uploaded-bytes ceiling. Default 512 KB. */
	maxTranscriptBytes?: number;
}

const DEFAULT_MAX_RESULT_BYTES = 32 * 1024;
const DEFAULT_MAX_TRANSCRIPT_BYTES = 512 * 1024;

function byteLength(s: string): number {
	return new TextEncoder().encode(s).length;
}

/**
 * Approximate the bytes a single dispatch uploads: the WHOLE transcript is re-sent
 * every turn, so the exfiltration metric is the cumulative size of all messages
 * (system + user + assistant text/tool-call args + every tool result), summed across
 * turns — not each tool result counted once. Counts text payloads; ignores wire
 * framing/JSON keys (a small, stable constant per message).
 */
function transcriptBytes(messages: NormalizedMessage[]): number {
	let n = 0;
	for (const m of messages) {
		if (m.role === "tool") {
			for (const r of m.results) n += byteLength(r.content);
			continue;
		}
		n += byteLength(m.content);
		if (m.role === "assistant" && m.toolCalls) {
			for (const c of m.toolCalls) {
				if (typeof c.rawArgs === "string") n += byteLength(c.rawArgs);
				else if (c.args) {
					try {
						n += byteLength(JSON.stringify(c.args));
					} catch {
						/* unserializable args — skip; can't be uploaded as JSON anyway */
					}
				}
			}
		}
	}
	return n;
}

/** Coerce a handler return value to a string for the wire, capped + crash-safe. */
export function stringifyToolResult(
	value: unknown,
	maxBytes: number,
): { content: string; isError: boolean } {
	let s: string;
	if (typeof value === "string") s = value;
	else if (value === null || value === undefined) s = '{"ok":true}';
	else {
		try {
			s = JSON.stringify(value);
		} catch {
			return {
				content: "tool returned a value that could not be serialized",
				isError: true,
			};
		}
	}
	if (byteLength(s) > maxBytes) {
		// Byte-accurate truncation: reserve room for the marker so the FINAL string
		// (content + marker) still fits maxBytes, and shrink the char cut until the
		// prefix fits that budget without splitting a code point.
		const marker = " …[truncated]";
		const budget = Math.max(0, maxBytes - byteLength(marker));
		let cut = Math.min(s.length, budget);
		while (cut > 0 && byteLength(s.slice(0, cut)) > budget) {
			cut = Math.floor(cut * 0.9) || cut - 1;
		}
		s = s.slice(0, cut) + marker;
	}
	return { content: s, isError: false };
}

export async function runToolLoop(
	deps: RunToolLoopDeps,
): Promise<RunToolLoopResult> {
	const maxResultBytes = deps.maxResultBytes ?? DEFAULT_MAX_RESULT_BYTES;
	const maxTranscriptBytes = deps.maxTranscriptBytes ?? DEFAULT_MAX_TRANSCRIPT_BYTES;
	const maxSteps = Math.max(1, deps.maxSteps);

	const messages: NormalizedMessage[] = [...deps.request.messages];
	const steps: LoopStep[] = [];
	const usage = { promptTokens: 0, completionTokens: 0, totalTokens: 0 };
	let uploadedBytes = 0;
	let forceFinal = false;
	let lastTurn: ParsedChatResult | null = null;

	for (let step = 0; step < maxSteps; step++) {
		if (step > 0 && deps.isOnlineDisabled?.()) {
			return finish("aborted");
		}

		// A step is final because the budget ran out (step ceiling) OR because a
		// prior step tripped stopWhen / the transcript-bytes ceiling (forceFinal).
		// Track WHICH so the early-return branch can report 'max-steps' only when the
		// budget forced it — the residual-toolCalls heuristic is unreachable via the
		// Agent, which strips tools on the final step (tools:undefined/toolChoice:'none').
		const budgetForcedFinal = step === maxSteps - 1;
		const isFinalStep = forceFinal || budgetForcedFinal;
		const turnReq: NormalizedChatRequest = {
			...deps.request,
			messages,
			...(isFinalStep ? { toolChoice: "none" as const } : {}),
		};

		// Account for the bytes THIS dispatch uploads (the full transcript, re-sent),
		// before sending — so a model that re-runs read tools to stream MB upstream
		// trips the ceiling even though each individual result is small.
		uploadedBytes += transcriptBytes(messages);

		let turn: ParsedChatResult;
		try {
			turn = await deps.dispatch(turnReq, { isFinalStep });
		} catch (e) {
			// A growing transcript can overflow the context window mid-loop. Stop
			// gracefully with whatever we have rather than throwing — no tool_use is
			// dangling here (results were appended last step).
			if (deps.isContextOverflow?.(e)) return finish("context-overflow");
			throw e;
		}
		lastTurn = turn;
		usage.promptTokens += turn.usage.promptTokens;
		usage.completionTokens += turn.usage.completionTokens;
		usage.totalTokens += turn.usage.totalTokens;

		// Stop when the model produced no tool calls, or we are on the forced-final step.
		if (
			turn.normalizedStopReason !== "tool_calls" ||
			turn.toolCalls.length === 0 ||
			isFinalStep
		) {
			steps.push({
				stepNumber: step,
				text: turn.content,
				toolCalls: turn.toolCalls,
				toolResults: [],
				finishReason: turn.rawStopReason,
				usage: turn.usage,
			});
			await deps.onStepFinish?.(steps[steps.length - 1]);
			// 'length' is a genuine provider output-cutoff signal and takes precedence.
			// Otherwise report 'max-steps' only when the budget (step ceiling) forced
			// this final step after at least one tool-using step — and no graceful stop
			// (stopWhen / transcript-bytes) had already pre-empted it. Reaching a
			// budget-forced final step at step > 0 means every prior step made tool
			// calls (else the loop returns "stop" earlier), so the budget genuinely cut
			// off an in-progress agentic run. A model that simply stopped, a single-turn
			// (maxSteps 1) answer, or a stopWhen/transcript-forced wrap-up is 'stop'.
			// (The Agent strips tools on the final step, so the model can no longer emit
			// tool calls here; deriving max-steps from residual toolCalls was unreachable
			// through the Agent.)
			const reason: LoopFinishReason =
				turn.normalizedStopReason === "length"
					? "length"
					: budgetForcedFinal && !forceFinal && step > 0
						? "max-steps"
						: "stop";
			return finish(reason);
		}

		// Append the assistant turn (content + tool calls + provider echo blob).
		messages.push({
			role: "assistant",
			content: turn.content,
			toolCalls: turn.toolCalls,
			providerRaw: turn.providerRaw,
		});

		// Resolve EVERY tool call to exactly one result (in id order, sequential).
		const results: NormalizedToolResult[] = [];
		for (const call of turn.toolCalls) {
			results.push(await resolveCall(call));
		}
		messages.push({ role: "tool", results });

		steps.push({
			stepNumber: step,
			text: turn.content,
			toolCalls: turn.toolCalls,
			toolResults: results,
			finishReason: turn.rawStopReason,
			usage: turn.usage,
		});
		await deps.onStepFinish?.(steps[steps.length - 1]);

		// Cumulative-bytes ceiling OR a user stopWhen condition → make the next step
		// the forced-final text turn.
		if (uploadedBytes > maxTranscriptBytes) forceFinal = true;
		if (deps.shouldStop?.({ steps })) forceFinal = true;
	}

	// Safety net (the forced-final step normally returns from inside the loop).
	return finish("max-steps");

	function finish(reason: LoopFinishReason): RunToolLoopResult {
		return {
			text: lastTurn?.content ?? "",
			steps,
			finishReason: reason,
			usage,
			messages,
			finalTurn:
				lastTurn ?? {
					content: "",
					toolCalls: [],
					normalizedStopReason: "stop",
					rawStopReason: "",
					usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
				},
		};
	}

	async function resolveCall(
		call: NormalizedToolCall,
	): Promise<NormalizedToolResult> {
		if (call.parseError) {
			return errResult(call, "could not parse the tool arguments as JSON");
		}
		const tool = deps.getTool(call.name);
		if (!tool) {
			return errResult(call, `unknown tool "${call.name}"`);
		}
		const args = call.args ?? {};
		const schemaError = deps.validateArgs(tool, args);
		if (schemaError) {
			return errResult(call, `invalid arguments: ${schemaError}`);
		}
		// confirm() throws on a hard cancel/abort (propagates and kills the macro).
		const allowed = await deps.confirm(call, tool);
		if (!allowed) {
			return errResult(call, "tool call denied by user");
		}
		let raw: unknown;
		try {
			raw = await tool.execute(args, { toolCallId: call.id, toolName: call.name });
		} catch (e) {
			if (deps.isAbortError(e)) throw e;
			return errResult(
				call,
				`tool execution failed: ${e instanceof Error ? e.message : String(e)}`,
			);
		}
		const { content, isError } = stringifyToolResult(raw, maxResultBytes);
		return { toolCallId: call.id, name: call.name, content, isError };
	}

	function errResult(
		call: NormalizedToolCall,
		message: string,
	): NormalizedToolResult {
		return { toolCallId: call.id, name: call.name, content: message, isError: true };
	}
}
