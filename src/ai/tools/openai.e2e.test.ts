/**
 * REAL-CALL e2e for the #714 wire against the live OpenAI API. Exercises the actual
 * pure modules (providerToolMapping.buildChatBody/parseChatResponse + runToolLoop +
 * jsonSchemaValidator) end-to-end — the layer the prototype could only mock.
 *
 * Skipped unless OPENAI_API_KEY is set, so the normal suite + CI never hit the network:
 *   OPENAI_API_KEY=$(op read "op://Agent Secrets/OpenAI API Key/credential") \
 *     npx vitest run src/ai/tools/openai.e2e.test.ts --config vitest.config.mts
 */
import { describe, it, expect } from "vitest";
import { buildChatBody, parseChatResponse } from "./providerToolMapping";
import { runToolLoop, type ToolEntry } from "./runToolLoop";
import { validateValue } from "./jsonSchemaValidator";
import type { NormalizedChatRequest } from "./NormalizedTools";

const KEY = process.env.OPENAI_API_KEY;
// Current-generation default (GPT-5.x). The bare request path sends no max_tokens and
// no temperature, so it is wire-compatible with GPT-5.x reasoning models (which reject
// `max_tokens` in favour of `max_completion_tokens` and only accept the default
// temperature). Override with OPENAI_E2E_MODEL to target a specific model.
const MODEL = process.env.OPENAI_E2E_MODEL ?? "gpt-5-mini";
const URL = "https://api.openai.com/v1/chat/completions";

async function openaiDispatch(req: NormalizedChatRequest) {
	const body = buildChatBody("openai", MODEL, req);
	const res = await fetch(URL, {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
			Authorization: `Bearer ${KEY}`,
		},
		body: JSON.stringify(body),
	});
	const json = (await res.json()) as Record<string, unknown>;
	if (!res.ok) throw new Error(`OpenAI ${res.status}: ${JSON.stringify(json)}`);
	return parseChatResponse("openai", json);
}

describe.skipIf(!KEY)("OpenAI live wire (e2e)", () => {
	it("runs a real tool-calling loop end-to-end", async () => {
		const calls: Array<{ a: number; b: number }> = [];
		const add: ToolEntry = {
			definition: {
				name: "add",
				description: "Add two integers and return their sum.",
				parameters: {
					type: "object",
					properties: { a: { type: "integer" }, b: { type: "integer" } },
					required: ["a", "b"],
				},
			},
			readOnly: true,
			execute: (args) => {
				const a = Number(args.a);
				const b = Number(args.b);
				calls.push({ a, b });
				return { sum: a + b };
			},
		};

		const res = await runToolLoop({
			request: {
				messages: [
					{ role: "system", content: "You must use the add tool to compute sums. Do not compute them yourself." },
					{ role: "user", content: "Use the add tool to add 17 and 25, then state the result as a number." },
				],
				tools: [add.definition],
				toolChoice: "auto",
			},
			maxSteps: 4,
			dispatch: (req) => openaiDispatch(req),
			getTool: (name) => (name === "add" ? add : undefined),
			confirm: async () => true,
			validateArgs: (tool, args) => validateValue(args, tool.definition.parameters),
			isAbortError: () => false,
		});

		expect(calls.length).toBeGreaterThanOrEqual(1);
		expect(calls[0]).toEqual({ a: 17, b: 25 });
		expect(res.text).toMatch(/42/);
		expect(res.finishReason).toBe("stop");
	}, 60000);

	it("returns schema-constrained structured output", async () => {
		const schema = {
			type: "object" as const,
			properties: {
				title: { type: "string" as const },
				tags: { type: "array" as const, items: { type: "string" as const } },
			},
			required: ["title", "tags"],
		};
		const parsed = await openaiDispatch({
			messages: [
				{ role: "user", content: "Extract the title and the tags (without '#') from this note: 'Hello World #alpha #beta'." },
			],
			responseFormat: { schema, name: "note_meta", strict: true },
		});
		const obj = JSON.parse(parsed.content) as { title: string; tags: string[] };
		expect(validateValue(obj, schema)).toBeNull();
		expect(typeof obj.title).toBe("string");
		expect(obj.tags).toEqual(expect.arrayContaining(["alpha", "beta"]));
	}, 60000);
});
