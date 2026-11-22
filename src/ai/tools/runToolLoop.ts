/**
 * Provider-agnostic agentic tool loop; every Obsidian/provider touch point is
 * injected. Each step runs every tool call (one result per call id) and repeats
 * until the model stops. The last allowed step forces toolChoice:'none' so the
 * run ends on a text answer. Abort errors propagate; any other handler throw
 * becomes an `isError` result the model can recover from. A step ceiling, a
 * per-result byte cap and a cumulative transcript-bytes ceiling bound cost and
 * exfiltration.
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
	) => unknown;
	readOnly?: boolean;
}

type LoopFinishReason =
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
	getTool: (name: string) => ToolEntry | undefined;
	/**
	 * Decide + gate one call. Return true to run it, false to decline (→ isError
	 * result). THROW (MacroAbortError/UserCancelError) to abort the whole run.
	 */
	confirm: (call: NormalizedToolCall, tool: ToolEntry) => Promise<boolean>;
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
 * The whole transcript is re-sent every turn, so uploaded bytes are the
 * cumulative size of all messages across turns. Wire framing is ignored.
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

		// Final because the step budget ran out, or because stopWhen or the byte
		// ceiling forced it; only the budget reports 'max-steps'.
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
			// A growing transcript can overflow the context window. Stop with what
			// we have; no tool_use is dangling here.
			if (deps.isContextOverflow?.(e)) return finish("context-overflow");
			throw e;
		}
		lastTurn = turn;
		usage.promptTokens += turn.usage.promptTokens;
		usage.completionTokens += turn.usage.completionTokens;
		usage.totalTokens += turn.usage.totalTokens;

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
			// 'length' is a provider cutoff and wins. Otherwise 'max-steps' only
			// when the step ceiling cut off a tool-using run; a model that stopped,
			// a single-turn answer, or a stopWhen/byte-forced wrap-up is 'stop'.
			const reason: LoopFinishReason =
				turn.normalizedStopReason === "length"
					? "length"
					: budgetForcedFinal && !forceFinal && step > 0
						? "max-steps"
						: "stop";
			return finish(reason);
		}

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
