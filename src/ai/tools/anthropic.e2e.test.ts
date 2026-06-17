/**
 * REAL-CALL e2e for the #714 wire against the live Anthropic Messages API. Exercises
 * the actual pure modules (providerToolMapping.buildChatBody/parseChatResponse +
 * runToolLoop + jsonSchemaValidator) end-to-end against a current Claude 4.x model.
 *
 * Skipped unless ANTHROPIC_API_KEY is set, so the normal suite + CI never hit the network:
 *   ANTHROPIC_API_KEY=$(op read "op://Agent Secrets/Anthropic Claude API Key/credential") \
 *     npx vitest run src/ai/tools/anthropic.e2e.test.ts --config vitest.config.mts
 */
import { describe, it, expect } from "vitest";
import { buildChatBody, parseChatResponse } from "./providerToolMapping";
import { runToolLoop, type ToolEntry } from "./runToolLoop";
import { validateValue } from "./jsonSchemaValidator";
import type { NormalizedChatRequest } from "./NormalizedTools";

const KEY = process.env.ANTHROPIC_API_KEY;
const MODEL = process.env.ANTHROPIC_E2E_MODEL ?? "claude-sonnet-4-6";
const URL = "https://api.anthropic.com/v1/messages";

async function anthropicDispatch(req: NormalizedChatRequest) {
	const body = buildChatBody("anthropic", MODEL, req, 1024);
	const res = await fetch(URL, {
		method: "POST",
		headers: {
			"content-type": "application/json",
			"x-api-key": KEY as string,
			"anthropic-version": "2023-06-01",
		},
		body: JSON.stringify(body),
	});
	const json = (await res.json()) as Record<string, unknown>;
	if (!res.ok) throw new Error(`Anthropic ${res.status}: ${JSON.stringify(json)}`);
	return parseChatResponse("anthropic", json);
}

describe.skipIf(!KEY)("Anthropic live wire (e2e)", () => {
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
			dispatch: (req) => anthropicDispatch(req),
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

	it("returns schema-constrained structured output (native output_config.format)", async () => {
		const schema = {
			type: "object" as const,
			properties: {
				title: { type: "string" as const },
				tags: { type: "array" as const, items: { type: "string" as const } },
			},
			required: ["title", "tags"],
		};
		const parsed = await anthropicDispatch({
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
