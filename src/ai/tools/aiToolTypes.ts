/**
 * Public, AI-SDK-shaped types for the QuickAdd Agent surface (#714).
 *
 * Pure (no Obsidian). These are what user scripts touch: `ai.tool(def)` builds a
 * QATool, agents take a `ToolSet` (object map keyed by tool name), and
 * `agent.generate()` resolves to a GenerateResult. Public field names mirror the
 * Vercel AI SDK (`input`/`output`, `inputSchema`, `needsApproval`); the internal
 * wire layer (NormalizedTools) translates at the boundary.
 */
import type { JSONSchema } from "./NormalizedTools";

export interface ToolExecuteContext {
	toolCallId: string;
	toolName: string;
}

/** What a script passes to `ai.tool()`. */
export interface ToolDefinitionInput {
	description: string;
	inputSchema: JSONSchema;
	execute: (
		input: Record<string, unknown>,
		ctx: ToolExecuteContext,
	) => unknown;
	/**
	 * Per-tool human-in-the-loop gate (AI-SDK name). A tool resolving to true is
	 * ALWAYS confirmed regardless of the global confirmToolCalls setting.
	 */
	needsApproval?:
		| boolean
		| ((opts: { args: Record<string, unknown> }) => boolean | Promise<boolean>);
	/** Read-only tools skip confirmation under the 'destructive' global setting. */
	readOnly?: boolean;
	/** OpenAI/Anthropic strict tool-input validation. */
	strict?: boolean;
}

/** A tool registered via `ai.tool()`. Branded so a ToolSet can't be a plain object. */
export interface QATool extends ToolDefinitionInput {
	readonly __qaTool: true;
}

export type ToolSet = Record<string, QATool>;

export type ToolChoice =
	| "auto"
	| "none"
	| "required"
	| { type: "tool"; toolName: string };

/**
 * A stop condition (AI-SDK parity). Built via `ai.stepCountIs(n)` / `ai.hasToolCall(name)`.
 * Evaluated after each tool-execution step; returning true ends the loop on a final
 * text turn. The hard `maxSteps` clamp always applies on top of these.
 */
export type StopCondition = (ctx: {
	stepNumber: number;
	toolCallNames: string[];
}) => boolean;

export interface PublicToolCall {
	toolCallId: string;
	toolName: string;
	/** AI-SDK uses `input` (not `args`). Null when the model's JSON args failed to parse. */
	input: Record<string, unknown> | null;
}

export interface PublicToolResult {
	toolCallId: string;
	toolName: string;
	output: string;
	isError: boolean;
}

export interface GenerateStep {
	stepNumber: number;
	text: string;
	toolCalls: PublicToolCall[];
	toolResults: PublicToolResult[];
	finishReason: string;
}

export interface GenerateUsage {
	inputTokens: number;
	outputTokens: number;
	totalTokens: number;
}

export interface GenerateResult {
	/** Final assistant text. */
	text: string;
	/** Present only when a `schema` was passed (structured output): the parsed + validated object. */
	object?: unknown;
	steps: GenerateStep[];
	/** Tool calls / results from the last step (AI-SDK semantics). */
	toolCalls: PublicToolCall[];
	toolResults: PublicToolResult[];
	usage: GenerateUsage;
	finishReason: string;
}

/** Config for `ai.agent(config)`. */
export interface AgentConfig {
	/**
	 * Bare model name, qualified "providerId/modelName" string, or an object
	 * whose optional `provider` (stable id or display name) scopes the lookup
	 * to one provider exactly.
	 */
	model: string | { name: string; provider?: string };
	system?: string;
	tools?: ToolSet;
	toolChoice?: ToolChoice;
	stopWhen?: StopCondition | StopCondition[];
	/** Sugar for `stopWhen: ai.stepCountIs(N)`. If both given, `stopWhen` also applies. */
	maxSteps?: number;
	maxOutputTokens?: number;
	modelOptions?: Record<string, number>;
}

/** Per-call options for `agent.generate(options)`. */
export interface GenerateOptions {
	prompt?: string;
	/** Present ⇒ structured output; result.object is populated. */
	schema?: JSONSchema;
	/** Per-call overrides of agent config. */
	system?: string;
	toolChoice?: ToolChoice;
	maxOutputTokens?: number;
	/** Write result.text into choiceExecutor.variables as <name> + <name>-quoted for {{VALUE:name}}. */
	assignToVariable?: string;
}
