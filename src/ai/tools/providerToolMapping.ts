/**
 * Pure per-provider build/parse for tool calling + structured output (#714).
 *
 * No Obsidian imports — fully unit-testable. The execute loop (runToolLoop) and the
 * chatRequest entrypoint use `buildChatBody` to turn a NormalizedChatRequest into a
 * provider request body, and `parseChatResponse` to turn the raw provider JSON into
 * a normalized result (content + toolCalls + stop reason + usage).
 *
 * The three providers diverge in three load-bearing ways (verified against the
 * fc-prototype + current docs): (1) where tool calls live, (2) how arguments are
 * encoded (OpenAI = JSON STRING → parse; Anthropic/Gemini = object), (3) how results
 * thread back (OpenAI flat tool message; Anthropic tool_result-first user turn;
 * Gemini functionResponse parts under a user turn — no "tool" role).
 */
import type {
	JSONSchema,
	NormalizedChatRequest,
	NormalizedMessage,
	NormalizedStopReason,
	NormalizedToolCall,
	NormalizedToolChoice,
	NormalizedToolDefinition,
} from "./NormalizedTools";

export type ProviderKind = "openai" | "anthropic" | "gemini";

export interface ParsedChatResult {
	content: string;
	toolCalls: NormalizedToolCall[];
	normalizedStopReason: NormalizedStopReason;
	rawStopReason: string;
	usage: { promptTokens: number; completionTokens: number; totalTokens: number };
	/** Opaque provider blocks to echo back next turn (Gemini thoughtSignature parts). */
	providerRaw?: unknown;
}

type Body = Record<string, unknown>;

// ---------------------------------------------------------------------------
// Strict-output schema injection (OpenAI structured output)
// ---------------------------------------------------------------------------
// OpenAI's `strict: true` requires additionalProperties:false AND every property
// listed in `required`, at every object level. Output schemas are a SEPARATE path
// from author tool-INPUT schemas (which the validator deliberately keeps free of
// additionalProperties), so we inject these here at send time.
export function injectStrictObjectSchema(schema: JSONSchema): JSONSchema {
	const out: JSONSchema = Array.isArray(schema)
		? schema
		: { ...schema };

	const isObject =
		out.type === "object" ||
		(Array.isArray(out.type) && out.type.includes("object")) ||
		out.properties !== undefined;

	if (out.properties) {
		const props: Record<string, JSONSchema> = {};
		for (const [k, v] of Object.entries(out.properties)) {
			props[k] = injectStrictObjectSchema(v);
		}
		out.properties = props;
	}
	if (out.items && !Array.isArray(out.items)) {
		out.items = injectStrictObjectSchema(out.items);
	}
	if (isObject) {
		out.additionalProperties = false;
		out.required = out.properties ? Object.keys(out.properties) : [];
	}
	return out;
}

// ===========================================================================
// OpenAI-compatible
// ===========================================================================
function openaiMessages(messages: NormalizedMessage[]): Body[] {
	const out: Body[] = [];
	for (const m of messages) {
		if (m.role === "system") out.push({ role: "system", content: m.content });
		else if (m.role === "user") out.push({ role: "user", content: m.content });
		else if (m.role === "assistant") {
			const msg: Body = { role: "assistant", content: m.content ?? "" };
			if (m.toolCalls && m.toolCalls.length > 0) {
				msg.tool_calls = m.toolCalls.map((c) => ({
					id: c.id,
					type: "function",
					function: {
						name: c.name,
						// Re-echo the exact original string when we have it (loss-free); else serialize.
						arguments: c.rawArgs ?? JSON.stringify(c.args ?? {}),
					},
				}));
			}
			out.push(msg);
		} else {
			// tool results: one flat {role:'tool'} message per result.
			for (const r of m.results) {
				out.push({
					role: "tool",
					tool_call_id: r.toolCallId,
					content: r.isError ? `ERROR: ${r.content}` : r.content,
				});
			}
		}
	}
	return out;
}

function openaiTools(tools: NormalizedToolDefinition[]): Body[] {
	return tools.map((t) => ({
		type: "function",
		function: {
			name: t.name,
			description: t.description,
			parameters: t.strict
				? injectStrictObjectSchema(t.parameters)
				: t.parameters,
			...(t.strict ? { strict: true } : {}),
		},
	}));
}

function openaiToolChoice(choice: NormalizedToolChoice): unknown {
	if (typeof choice === "string") return choice; // 'auto' | 'none' | 'required'
	return { type: "function", function: { name: choice.name } };
}

// OpenAI reasoning models (o-series, and gpt-5 / newer) reject the classic
// `max_tokens` — they require `max_completion_tokens`. Detect by NAME so the rename
// applies only to OpenAI-proper's reasoning line: OpenAI-compatible endpoints
// (Ollama / Groq / Together / …), whose model names don't match this shape, keep
// `max_tokens`. Forward-looking: matches gpt-5..gpt-9 and gpt-10+ as well as o1..o9.
const OPENAI_REASONING_MODEL_RE = /^(?:o[1-9]|gpt-(?:[5-9]|\d\d))/i;

function buildOpenAIBody(modelName: string, req: NormalizedChatRequest): Body {
	const body: Body = {
		model: modelName,
		...(req.modelParams ?? {}),
		messages: openaiMessages(req.messages),
	};
	if (req.tools && req.tools.length > 0) {
		body.tools = openaiTools(req.tools);
		if (req.toolChoice) body.tool_choice = openaiToolChoice(req.toolChoice);
		if (req.disableParallel) body.parallel_tool_calls = false;
	}
	if (req.maxOutputTokens !== undefined) {
		if (OPENAI_REASONING_MODEL_RE.test(modelName))
			body.max_completion_tokens = req.maxOutputTokens;
		else body.max_tokens = req.maxOutputTokens;
	}
	if (req.responseFormat) {
		body.response_format = req.responseFormat.schema
			? {
					type: "json_schema",
					json_schema: {
						name: req.responseFormat.name ?? "response",
						// Default to a real guarantee: strict + injected output schema.
						strict: req.responseFormat.strict ?? true,
						schema:
							(req.responseFormat.strict ?? true)
								? injectStrictObjectSchema(req.responseFormat.schema)
								: req.responseFormat.schema,
					},
			  }
			: { type: "json_object" };
	}
	return body;
}

interface OpenAIToolCallRaw {
	id: string;
	function: { name: string; arguments: unknown };
}
function parseOpenAIResponse(json: Record<string, unknown>): ParsedChatResult {
	const choice = (json.choices as Array<Record<string, unknown>>)?.[0] ?? {};
	const msg = (choice.message as Record<string, unknown>) ?? {};
	const rawCalls = (msg.tool_calls as OpenAIToolCallRaw[] | undefined) ?? [];
	const toolCalls = rawCalls.map((tc) => parseOpenAIToolCall(tc));
	const finish = String(choice.finish_reason ?? "");
	const usage = (json.usage as Record<string, number>) ?? {};
	return {
		content: (msg.content as string) ?? "",
		toolCalls,
		normalizedStopReason:
			toolCalls.length > 0 || finish === "tool_calls"
				? "tool_calls"
				: finish === "length"
					? "length"
					: finish === "stop"
						? "stop"
						: "other",
		rawStopReason: finish,
		usage: {
			promptTokens: usage.prompt_tokens ?? 0,
			completionTokens: usage.completion_tokens ?? 0,
			totalTokens: usage.total_tokens ?? 0,
		},
	};
}

/** A tool call's args MUST be a JSON object — arrays/primitives violate the contract. */
function asArgsRecord(value: unknown): Record<string, unknown> | null {
	return value !== null && typeof value === "object" && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: null;
}

function parseOpenAIToolCall(tc: OpenAIToolCallRaw): NormalizedToolCall {
	const raw = tc.function.arguments;
	if (typeof raw === "string") {
		try {
			const rec = asArgsRecord(JSON.parse(raw || "{}"));
			if (!rec) throw new Error("tool arguments are not a JSON object");
			return { id: tc.id, name: tc.function.name, args: rec, rawArgs: raw };
		} catch {
			return {
				id: tc.id,
				name: tc.function.name,
				args: null,
				rawArgs: raw,
				parseError: true,
			};
		}
	}
	// Defensive: some OpenAI-compatible servers (Ollama native) send an object.
	const rec = asArgsRecord(raw);
	if (!rec) {
		return {
			id: tc.id,
			name: tc.function.name,
			args: null,
			rawArgs: typeof raw === "string" ? raw : JSON.stringify(raw ?? {}),
			parseError: true,
		};
	}
	return { id: tc.id, name: tc.function.name, args: rec };
}

// ===========================================================================
// Anthropic
// ===========================================================================
function buildAnthropicBody(
	modelName: string,
	req: NormalizedChatRequest,
	defaultMaxTokens: number,
): Body {
	const systemParts: string[] = [];
	const messages: Body[] = [];
	for (const m of req.messages) {
		if (m.role === "system") {
			if (m.content) systemParts.push(m.content);
		} else if (m.role === "user") {
			messages.push({ role: "user", content: m.content });
		} else if (m.role === "assistant") {
			const blocks: Body[] = [];
			if (m.content) blocks.push({ type: "text", text: m.content }); // text BEFORE tool_use
			for (const c of m.toolCalls ?? [])
				blocks.push({ type: "tool_use", id: c.id, name: c.name, input: c.args ?? {} });
			messages.push({ role: "assistant", content: blocks });
		} else {
			// tool_result blocks FIRST in a new user turn, immediately after tool_use.
			messages.push({
				role: "user",
				content: m.results.map((r) => ({
					type: "tool_result",
					tool_use_id: r.toolCallId,
					content: r.content,
					...(r.isError ? { is_error: true } : {}),
				})),
			});
		}
	}

	const body: Body = {
		model: modelName,
		max_tokens: req.maxOutputTokens ?? defaultMaxTokens,
		messages,
	};
	if (systemParts.length > 0) body.system = systemParts.join("\n\n");
	// Forward the user's sampling settings (previously dropped on this path).
	// Only the params the Messages API knows; the OpenAI-specific penalty
	// params would be rejected as unknown fields.
	const anthropicParams = req.modelParams ?? {};
	if (typeof anthropicParams.temperature === "number") {
		body.temperature = anthropicParams.temperature;
	}
	if (typeof anthropicParams.top_p === "number") {
		body.top_p = anthropicParams.top_p;
	}
	if (req.tools && req.tools.length > 0) {
		// NOTE: the Anthropic Messages API has no tool-level `strict` field (that is
		// OpenAI-only) — sending one risks an unknown-field 400, so we never do.
		body.tools = req.tools.map((t) => ({
			name: t.name,
			description: t.description,
			input_schema: t.parameters,
		}));
		if (req.toolChoice) {
			body.tool_choice = anthropicToolChoice(req.toolChoice, req.disableParallel);
		} else if (req.disableParallel) {
			body.tool_choice = { type: "auto", disable_parallel_tool_use: true };
		}
	}
	if (req.responseFormat?.schema) {
		// Native structured output (GA on Claude 4.x). Anthropic REQUIRES every object
		// in the schema to set `additionalProperties: false` (verified live: a raw
		// schema 400s with "additionalProperties must be explicitly set to false") — so
		// inject it (and the all-required closure), exactly as the OpenAI strict path does.
		body.output_config = {
			format: {
				type: "json_schema",
				schema: injectStrictObjectSchema(req.responseFormat.schema),
			},
		};
	}
	return body;
}

function anthropicToolChoice(
	choice: NormalizedToolChoice,
	disableParallel?: boolean,
): Body {
	const dp = disableParallel ? { disable_parallel_tool_use: true } : {};
	if (typeof choice === "string") {
		if (choice === "required") return { type: "any", ...dp };
		if (choice === "none") return { type: "none" };
		return { type: "auto", ...dp };
	}
	return { type: "tool", name: choice.name, ...dp };
}

interface AnthropicBlockRaw {
	type: string;
	text?: string;
	id?: string;
	name?: string;
	input?: Record<string, unknown>;
}
function parseAnthropicResponse(json: Record<string, unknown>): ParsedChatResult {
	const blocks = (json.content as AnthropicBlockRaw[] | undefined) ?? [];
	const toolCalls: NormalizedToolCall[] = blocks
		.filter((b) => b.type === "tool_use")
		.map((b) => ({ id: b.id ?? "", name: b.name ?? "", args: b.input ?? {} }));
	const stop = String(json.stop_reason ?? "");
	const usage = (json.usage as Record<string, number>) ?? {};
	const input = usage.input_tokens ?? 0;
	const output = usage.output_tokens ?? 0;
	return {
		content: blocks
			.filter((b) => b.type === "text")
			.map((b) => b.text ?? "")
			.join(""),
		toolCalls,
		normalizedStopReason:
			stop === "tool_use" || toolCalls.length > 0
				? "tool_calls"
				: stop === "max_tokens"
					? "length"
					: stop === "end_turn" || stop === "stop_sequence"
						? "stop"
						: "other",
		rawStopReason: stop,
		usage: { promptTokens: input, completionTokens: output, totalTokens: input + output },
	};
}

// ===========================================================================
// Gemini
// ===========================================================================
function buildGeminiBody(modelName: string, req: NormalizedChatRequest): Body {
	const systemParts: string[] = [];
	const contents: Body[] = [];
	for (const m of req.messages) {
		if (m.role === "system") {
			if (m.content) systemParts.push(m.content);
		} else if (m.role === "user") {
			contents.push({ role: "user", parts: [{ text: m.content }] });
		} else if (m.role === "assistant") {
			// Echo the original parts verbatim when present (preserves thoughtSignature).
			if (Array.isArray(m.providerRaw)) {
				contents.push({ role: "model", parts: m.providerRaw as Body[] });
			} else {
				const parts: Body[] = [];
				if (m.content) parts.push({ text: m.content });
				for (const c of m.toolCalls ?? [])
					parts.push({ functionCall: { name: c.name, args: c.args ?? {} } });
				contents.push({ role: "model", parts });
			}
		} else {
			contents.push({
				role: "user",
				parts: m.results.map((r) => ({
					functionResponse: {
						name: r.name,
						response: r.isError ? { error: r.content } : { result: r.content },
					},
				})),
			});
		}
	}

	const body: Body = { contents };
	if (systemParts.length > 0) {
		body.systemInstruction = {
			role: "system",
			parts: [{ text: systemParts.join("\n\n") }],
		};
	}
	if (req.tools && req.tools.length > 0) {
		body.tools = [
			{
				functionDeclarations: req.tools.map((t) => ({
					name: t.name,
					description: t.description,
					parameters: t.parameters,
				})),
			},
		];
		if (req.toolChoice) body.toolConfig = geminiToolConfig(req.toolChoice);
	}
	const generationConfig: Body = {};
	const mp = req.modelParams ?? {};
	if (typeof mp.temperature === "number") generationConfig.temperature = mp.temperature;
	if (typeof mp.top_p === "number") generationConfig.topP = mp.top_p;
	if (req.maxOutputTokens !== undefined)
		generationConfig.maxOutputTokens = req.maxOutputTokens;
	if (req.responseFormat?.schema) {
		generationConfig.responseMimeType = "application/json";
		generationConfig.responseSchema = req.responseFormat.schema;
	}
	if (Object.keys(generationConfig).length > 0)
		body.generationConfig = generationConfig;
	return body;
}

function geminiToolConfig(choice: NormalizedToolChoice): Body {
	if (typeof choice === "string") {
		const mode =
			choice === "required" ? "ANY" : choice === "none" ? "NONE" : "AUTO";
		return { functionCallingConfig: { mode } };
	}
	return {
		functionCallingConfig: { mode: "ANY", allowedFunctionNames: [choice.name] },
	};
}

interface GeminiPartRaw {
	text?: string;
	functionCall?: { id?: string; name: string; args?: Record<string, unknown> };
	[key: string]: unknown;
}
function parseGeminiResponse(json: Record<string, unknown>): ParsedChatResult {
	const candidate =
		(json.candidates as Array<Record<string, unknown>> | undefined)?.[0] ?? {};
	const content = (candidate.content as { parts?: GeminiPartRaw[] }) ?? {};
	const parts = content.parts ?? [];
	const toolCalls: NormalizedToolCall[] = parts
		.filter((p) => p.functionCall)
		.map((p, i) => ({
			id: p.functionCall?.id ?? `gemini-call-${i}`,
			name: p.functionCall?.name ?? "",
			args: p.functionCall?.args ?? {},
		}));
	const finish = String(candidate.finishReason ?? "");
	const meta = (json.usageMetadata as Record<string, number>) ?? {};
	return {
		content: parts
			.filter((p) => typeof p.text === "string")
			.map((p) => p.text ?? "")
			.join(""),
		toolCalls,
		normalizedStopReason:
			toolCalls.length > 0
				? "tool_calls"
				: finish === "MAX_TOKENS"
					? "length"
					: finish === "STOP"
						? "stop"
						: "other",
		rawStopReason: finish,
		usage: {
			promptTokens: meta.promptTokenCount ?? 0,
			completionTokens: meta.candidatesTokenCount ?? 0,
			totalTokens: meta.totalTokenCount ?? 0,
		},
		// Preserve raw parts so the next turn can echo thoughtSignature unchanged.
		providerRaw: parts,
	};
}

// ===========================================================================
// Dispatch
// ===========================================================================
export function buildChatBody(
	kind: ProviderKind,
	modelName: string,
	req: NormalizedChatRequest,
	anthropicDefaultMaxTokens = 8192,
): Body {
	switch (kind) {
		case "anthropic":
			return buildAnthropicBody(modelName, req, anthropicDefaultMaxTokens);
		case "gemini":
			return buildGeminiBody(modelName, req);
		default:
			return buildOpenAIBody(modelName, req);
	}
}

export function parseChatResponse(
	kind: ProviderKind,
	json: Record<string, unknown>,
): ParsedChatResult {
	switch (kind) {
		case "anthropic":
			return parseAnthropicResponse(json);
		case "gemini":
			return parseGeminiResponse(json);
		default:
			return parseOpenAIResponse(json);
	}
}
