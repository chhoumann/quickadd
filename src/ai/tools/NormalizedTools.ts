/**
 * Provider-neutral tool-calling types for QuickAdd's AI layer (#714).
 *
 * INTERFACE-ONLY — this module imports only the pure OpenAIModelParameters type (no
 * Obsidian, no settings), so the pure provider mappers and the execute loop that
 * consume it stay unit-testable under vitest/jsdom. The public, AI-SDK-shaped surface
 * (Agent / tool() / result) lives in `aiToolTypes.ts`; this file is the internal wire
 * representation that the per-provider build/parse functions map to and from.
 */
import type { OpenAIModelParameters } from "../OpenAIModelParameters";

/**
 * A minimal JSON Schema shape. QuickAdd has no Zod dependency (bundle-size
 * sensitive), so tool input/output schemas are plain JSON Schema objects. The
 * in-house validator (see `jsonSchemaValidator.ts`) accepts only a documented
 * subset and rejects unsupported keywords at registration — this type stays
 * permissive so authors can still express that subset naturally.
 */
export interface JSONSchema {
	type?: JSONSchemaType | JSONSchemaType[];
	properties?: Record<string, JSONSchema>;
	items?: JSONSchema | JSONSchema[];
	required?: string[];
	enum?: unknown[];
	const?: unknown;
	description?: string;
	[keyword: string]: unknown;
}

export type JSONSchemaType =
	| "object"
	| "array"
	| "string"
	| "number"
	| "integer"
	| "boolean"
	| "null";

/** A tool as sent to the provider (no handler — that lives in the registry). */
export interface NormalizedToolDefinition {
	/** Must match ^[a-zA-Z0-9_-]{1,64}$ (Anthropic's strictest rule, enforced for all). */
	name: string;
	description: string;
	parameters: JSONSchema;
	/** OpenAI/Anthropic strict mode; ignored by Gemini. */
	strict?: boolean;
}

/**
 * A tool call the model asked for, normalized across providers.
 * `args` is ALWAYS a parsed object internally — except when the provider sent
 * unparseable JSON (OpenAI streams arguments as a JSON string), in which case
 * `args` is null, `rawArgs` holds the original string, and `parseError` is true so
 * the loop emits an `isError` result for this call rather than running a handler.
 */
export interface NormalizedToolCall {
	id: string;
	name: string;
	args: Record<string, unknown> | null;
	rawArgs?: string;
	parseError?: boolean;
}

/** The result of executing one tool call, normalized for the result turn. */
export interface NormalizedToolResult {
	toolCallId: string;
	/** The tool name — REQUIRED because Gemini's functionResponse needs it. */
	name: string;
	content: string;
	isError?: boolean;
}

/**
 * One turn of the conversation. The assistant turn keeps `content` and
 * `toolCalls` separate; the per-provider builder is responsible for emitting them
 * in the order each provider requires (e.g. Anthropic needs text blocks before
 * tool_use blocks). `providerRaw` carries opaque provider blocks that must be
 * echoed back unchanged across turns (Gemini 3 `thoughtSignature` parts).
 */
export type NormalizedMessage =
	| { role: "system"; content: string }
	| { role: "user"; content: string }
	| {
			role: "assistant";
			content: string;
			toolCalls?: NormalizedToolCall[];
			providerRaw?: unknown;
	  }
	| { role: "tool"; results: NormalizedToolResult[] };

export type NormalizedToolChoice =
	| "auto"
	| "none"
	| "required"
	| { name: string };

/** A JSON-schema-constrained output request (structured output). */
export interface NormalizedResponseFormat {
	schema?: JSONSchema;
	name?: string;
	strict?: boolean;
}

/** A provider-neutral chat request. The mappers turn this into each provider's body. */
export interface NormalizedChatRequest {
	messages: NormalizedMessage[];
	tools?: NormalizedToolDefinition[];
	toolChoice?: NormalizedToolChoice;
	/** Ask the provider to emit at most one tool call per turn (no-op on Gemini). */
	disableParallel?: boolean;
	maxOutputTokens?: number;
	responseFormat?: NormalizedResponseFormat;
	modelParams?: Partial<OpenAIModelParameters>;
}

/** Normalized stop/finish reason. `rawStopReason` on CommonResponse keeps the original. */
export type NormalizedStopReason = "stop" | "tool_calls" | "length" | "other";
