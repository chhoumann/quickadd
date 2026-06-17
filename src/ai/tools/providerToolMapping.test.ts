import { describe, it, expect } from "vitest";
import {
	buildChatBody,
	parseChatResponse,
	injectStrictObjectSchema,
} from "./providerToolMapping";
import type { NormalizedChatRequest } from "./NormalizedTools";

const tool = {
	name: "create_note",
	description: "Create a note",
	parameters: { type: "object" as const, properties: { path: { type: "string" as const } }, required: ["path"] },
};

describe("buildChatBody — byte-minimal when no tools/schema (byte-identity lock)", () => {
	const req: NormalizedChatRequest = { messages: [{ role: "user", content: "hi" }] };
	it("OpenAI: omits tools/tool_choice/response_format entirely", () => {
		const body = buildChatBody("openai", "gpt-4o", req);
		expect(Object.keys(body).sort()).toEqual(["messages", "model"].sort());
	});
	it("Anthropic: only model/max_tokens/messages (no tools/output_config/system)", () => {
		const body = buildChatBody("anthropic", "claude-3-5-sonnet", req, 8192);
		expect(Object.keys(body).sort()).toEqual(["max_tokens", "messages", "model"].sort());
		expect(body.max_tokens).toBe(8192);
	});
	it("Gemini: only contents (no tools/toolConfig/generationConfig/systemInstruction)", () => {
		const body = buildChatBody("gemini", "gemini-1.5-pro", req);
		expect(Object.keys(body)).toEqual(["contents"]);
	});
});

describe("OpenAI mapping", () => {
	it("builds function tools + tool_choice + parallel flag", () => {
		const req: NormalizedChatRequest = {
			messages: [{ role: "user", content: "make a note" }],
			tools: [tool],
			toolChoice: { name: "create_note" },
			disableParallel: true,
		};
		const body = buildChatBody("openai", "gpt-4o", req) as Record<string, unknown>;
		expect(body.tools).toEqual([
			{ type: "function", function: { name: "create_note", description: "Create a note", parameters: tool.parameters } },
		]);
		expect(body.tool_choice).toEqual({ type: "function", function: { name: "create_note" } });
		expect(body.parallel_tool_calls).toBe(false);
	});

	it("threads an assistant tool-call turn (args as JSON string, rawArgs preserved) and flat tool results", () => {
		const req: NormalizedChatRequest = {
			messages: [
				{ role: "user", content: "q" },
				{ role: "assistant", content: "", toolCalls: [{ id: "call_1", name: "create_note", args: { path: "a.md" }, rawArgs: '{"path":"a.md"}' }] },
				{ role: "tool", results: [{ toolCallId: "call_1", name: "create_note", content: "ok" }] },
			],
			tools: [tool],
		};
		const body = buildChatBody("openai", "gpt-4o", req) as Record<string, unknown>;
		const msgs = body.messages as Array<Record<string, unknown>>;
		const assistant = msgs[1];
		expect((assistant.tool_calls as Array<Record<string, unknown>>)[0]).toMatchObject({
			id: "call_1",
			type: "function",
			function: { name: "create_note", arguments: '{"path":"a.md"}' },
		});
		expect(msgs[2]).toEqual({ role: "tool", tool_call_id: "call_1", content: "ok" });
	});

	it("parses a JSON-STRING arguments tool call", () => {
		const res = parseChatResponse("openai", {
			choices: [{ finish_reason: "tool_calls", message: { content: null, tool_calls: [{ id: "c1", function: { name: "create_note", arguments: '{"path":"x.md"}' } }] } }],
			usage: { prompt_tokens: 1, completion_tokens: 2, total_tokens: 3 },
		});
		expect(res.normalizedStopReason).toBe("tool_calls");
		expect(res.toolCalls[0]).toMatchObject({ id: "c1", name: "create_note", args: { path: "x.md" }, rawArgs: '{"path":"x.md"}' });
	});

	it("flags malformed JSON arguments with parseError (no throw)", () => {
		const res = parseChatResponse("openai", {
			choices: [{ finish_reason: "tool_calls", message: { tool_calls: [{ id: "c1", function: { name: "create_note", arguments: "{not json" } }] } }],
		});
		expect(res.toolCalls[0]).toMatchObject({ id: "c1", args: null, parseError: true });
	});

	it("defensively accepts object arguments (Ollama-native)", () => {
		const res = parseChatResponse("openai", {
			choices: [{ finish_reason: "tool_calls", message: { tool_calls: [{ id: "c1", function: { name: "create_note", arguments: { path: "x.md" } } }] } }],
		});
		expect(res.toolCalls[0].args).toEqual({ path: "x.md" });
		expect(res.toolCalls[0].parseError).toBeUndefined();
	});

	it("flags non-object args (array/primitive) as parseError — args must be an object", () => {
		const arr = parseChatResponse("openai", {
			choices: [{ finish_reason: "tool_calls", message: { tool_calls: [{ id: "c1", function: { name: "t", arguments: "[1,2]" } }] } }],
		});
		expect(arr.toolCalls[0]).toMatchObject({ args: null, parseError: true });
		const prim = parseChatResponse("openai", {
			choices: [{ finish_reason: "tool_calls", message: { tool_calls: [{ id: "c2", function: { name: "t", arguments: 5 as unknown as string } }] } }],
		});
		expect(prim.toolCalls[0]).toMatchObject({ args: null, parseError: true });
	});

	it("uses max_completion_tokens for reasoning models (gpt-5+/o-series), max_tokens otherwise", () => {
		const req: NormalizedChatRequest = {
			messages: [{ role: "user", content: "q" }],
			maxOutputTokens: 1234,
		};
		const pick = (model: string) => {
			const b = buildChatBody("openai", model, req) as Record<string, unknown>;
			return { mc: b.max_completion_tokens, mt: b.max_tokens };
		};
		// Reasoning line → max_completion_tokens
		expect(pick("gpt-5.5")).toEqual({ mc: 1234, mt: undefined });
		expect(pick("gpt-5-mini")).toEqual({ mc: 1234, mt: undefined });
		expect(pick("o3")).toEqual({ mc: 1234, mt: undefined });
		// Classic OpenAI + OpenAI-compatible (Ollama/Groq names) → max_tokens
		expect(pick("gpt-4o")).toEqual({ mc: undefined, mt: 1234 });
		expect(pick("llama3.1")).toEqual({ mc: undefined, mt: 1234 });
	});

	it("builds a strict json_schema response_format with injected additionalProperties + required", () => {
		const req: NormalizedChatRequest = {
			messages: [{ role: "user", content: "extract" }],
			responseFormat: { schema: { type: "object", properties: { title: { type: "string" } } }, name: "doc" },
		};
		const body = buildChatBody("openai", "gpt-4o", req) as Record<string, unknown>;
		const rf = body.response_format as Record<string, unknown>;
		expect(rf.type).toBe("json_schema");
		const js = rf.json_schema as Record<string, unknown>;
		expect(js).toMatchObject({ name: "doc", strict: true });
		expect(js.schema).toMatchObject({ additionalProperties: false, required: ["title"] });
	});
});

describe("Anthropic mapping", () => {
	it("hoists system to top level and orders assistant text before tool_use; tool_result leads the next user turn", () => {
		const req: NormalizedChatRequest = {
			messages: [
				{ role: "system", content: "be helpful" },
				{ role: "user", content: "q" },
				{ role: "assistant", content: "let me check", toolCalls: [{ id: "tu1", name: "create_note", args: { path: "a.md" } }] },
				{ role: "tool", results: [{ toolCallId: "tu1", name: "create_note", content: "done", isError: false }] },
			],
			tools: [tool],
			toolChoice: "required",
		};
		const body = buildChatBody("anthropic", "claude-3-5-sonnet", req) as Record<string, unknown>;
		expect(body.system).toBe("be helpful");
		const msgs = body.messages as Array<Record<string, unknown>>;
		// system removed from messages
		expect(msgs.map((m) => m.role)).toEqual(["user", "assistant", "user"]);
		const assistantBlocks = msgs[1].content as Array<Record<string, unknown>>;
		expect(assistantBlocks[0]).toEqual({ type: "text", text: "let me check" });
		expect(assistantBlocks[1]).toMatchObject({ type: "tool_use", id: "tu1", name: "create_note" });
		const resultBlocks = msgs[2].content as Array<Record<string, unknown>>;
		expect(resultBlocks[0]).toMatchObject({ type: "tool_result", tool_use_id: "tu1", content: "done" });
		expect(body.tool_choice).toMatchObject({ type: "any" });
	});

	it("maps native output_config for structured output, injecting additionalProperties:false + required (Anthropic requires it)", () => {
		const req: NormalizedChatRequest = {
			messages: [{ role: "user", content: "x" }],
			responseFormat: { schema: { type: "object", properties: { a: { type: "string" } } } },
		};
		const body = buildChatBody("anthropic", "claude-sonnet-4-6", req) as Record<string, unknown>;
		expect(body.output_config).toEqual({
			format: {
				type: "json_schema",
				schema: { type: "object", additionalProperties: false, required: ["a"], properties: { a: { type: "string" } } },
			},
		});
	});

	it("maps tool_choice variants and disable_parallel_tool_use", () => {
		const base: NormalizedChatRequest = { messages: [{ role: "user", content: "q" }], tools: [tool] };
		const pick = (r: NormalizedChatRequest) => (buildChatBody("anthropic", "m", r) as Record<string, unknown>).tool_choice;
		expect(pick({ ...base, toolChoice: { name: "create_note" } })).toEqual({ type: "tool", name: "create_note" });
		expect(pick({ ...base, disableParallel: true })).toEqual({ type: "auto", disable_parallel_tool_use: true });
		expect(pick({ ...base, toolChoice: "required", disableParallel: true })).toEqual({ type: "any", disable_parallel_tool_use: true });
	});

	it("never sends a tool-level strict field (no such field on the Anthropic API)", () => {
		const body = buildChatBody("anthropic", "m", { messages: [{ role: "user", content: "q" }], tools: [{ ...tool, strict: true }] }) as Record<string, unknown>;
		expect((body.tools as Array<Record<string, unknown>>)[0]).toEqual({ name: "create_note", description: "Create a note", input_schema: tool.parameters });
	});

	it("parses tool_use blocks and joins text across all blocks", () => {
		const res = parseChatResponse("anthropic", {
			stop_reason: "tool_use",
			content: [
				{ type: "text", text: "thinking " },
				{ type: "tool_use", id: "tu1", name: "create_note", input: { path: "a.md" } },
			],
			usage: { input_tokens: 5, output_tokens: 7 },
		});
		expect(res.content).toBe("thinking ");
		expect(res.normalizedStopReason).toBe("tool_calls");
		expect(res.toolCalls[0]).toMatchObject({ id: "tu1", name: "create_note", args: { path: "a.md" } });
		expect(res.usage).toEqual({ promptTokens: 5, completionTokens: 7, totalTokens: 12 });
	});
});

describe("Gemini mapping", () => {
	it("uses role 'model' + functionResponse user parts, no 'tool' role; sets functionDeclarations + responseSchema", () => {
		const req: NormalizedChatRequest = {
			messages: [
				{ role: "system", content: "sys" },
				{ role: "user", content: "q" },
				{ role: "assistant", content: "", toolCalls: [{ id: "g0", name: "create_note", args: { path: "a.md" } }] },
				{ role: "tool", results: [{ toolCallId: "g0", name: "create_note", content: "ok" }] },
			],
			tools: [tool],
			toolChoice: "auto",
			responseFormat: { schema: { type: "object", properties: { a: { type: "string" } } } },
		};
		const body = buildChatBody("gemini", "gemini-1.5-pro", req) as Record<string, unknown>;
		expect(body.systemInstruction).toMatchObject({ role: "system" });
		const contents = body.contents as Array<Record<string, unknown>>;
		expect(contents.map((c) => c.role)).toEqual(["user", "model", "user"]);
		const modelParts = contents[1].parts as Array<Record<string, unknown>>;
		expect(modelParts.some((p) => p.functionCall)).toBe(true);
		const fnRespParts = contents[2].parts as Array<Record<string, unknown>>;
		expect(fnRespParts[0]).toEqual({ functionResponse: { name: "create_note", response: { result: "ok" } } });
		expect(body.tools).toEqual([{ functionDeclarations: [{ name: "create_note", description: "Create a note", parameters: tool.parameters }] }]);
		const gc = body.generationConfig as Record<string, unknown>;
		expect(gc.responseMimeType).toBe("application/json");
		expect(gc.responseSchema).toBeDefined();
	});

	it("echoes the original parts verbatim when providerRaw is present (preserves thoughtSignature)", () => {
		const raw = [{ functionCall: { name: "create_note", args: { path: "a.md" } }, thoughtSignature: "sig123" }];
		const req: NormalizedChatRequest = {
			messages: [
				{ role: "user", content: "q" },
				{ role: "assistant", content: "", toolCalls: [{ id: "g0", name: "create_note", args: { path: "a.md" } }], providerRaw: raw },
			],
			tools: [tool],
		};
		const body = buildChatBody("gemini", "gemini-1.5-pro", req) as Record<string, unknown>;
		const contents = body.contents as Array<Record<string, unknown>>;
		expect(contents[1].parts).toBe(raw);
	});

	it("maps toolConfig mode for required and a forced {name}", () => {
		const base: NormalizedChatRequest = { messages: [{ role: "user", content: "q" }], tools: [tool] };
		const cfg = (r: NormalizedChatRequest) => (buildChatBody("gemini", "m", r) as Record<string, unknown>).toolConfig;
		expect(cfg({ ...base, toolChoice: "required" })).toEqual({ functionCallingConfig: { mode: "ANY" } });
		expect(cfg({ ...base, toolChoice: { name: "create_note" } })).toEqual({ functionCallingConfig: { mode: "ANY", allowedFunctionNames: ["create_note"] } });
		expect(cfg({ ...base, toolChoice: "none" })).toEqual({ functionCallingConfig: { mode: "NONE" } });
	});

	it("parses functionCall parts (synthesizing ids) and keeps raw parts for echo", () => {
		const res = parseChatResponse("gemini", {
			candidates: [{ content: { role: "model", parts: [{ text: "ok " }, { functionCall: { name: "create_note", args: { path: "a.md" } } }] }, finishReason: "STOP" }],
			usageMetadata: { promptTokenCount: 3, candidatesTokenCount: 4, totalTokenCount: 7 },
		});
		expect(res.content).toBe("ok ");
		expect(res.normalizedStopReason).toBe("tool_calls");
		expect(res.toolCalls[0]).toMatchObject({ id: "gemini-call-0", name: "create_note", args: { path: "a.md" } });
		expect(Array.isArray(res.providerRaw)).toBe(true);
	});
});

describe("injectStrictObjectSchema", () => {
	it("adds additionalProperties:false + required at every object level", () => {
		const out = injectStrictObjectSchema({
			type: "object",
			properties: { outer: { type: "object", properties: { inner: { type: "string" } } } },
		});
		expect(out).toMatchObject({ additionalProperties: false, required: ["outer"] });
		expect((out.properties?.outer as Record<string, unknown>)).toMatchObject({
			additionalProperties: false,
			required: ["inner"],
		});
	});
});
