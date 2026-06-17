/**
 * REAL-CALL e2e for the #714 wire against the live Gemini generateContent API.
 * Exercises the actual pure modules (providerToolMapping.buildChatBody/parseChatResponse
 * + runToolLoop + jsonSchemaValidator) end-to-end against a current Gemini 3.x model,
 * including the `model` role + functionResponse round-trip and the thoughtSignature echo
 * (parseChatResponse preserves the raw parts as providerRaw; buildChatBody replays them).
 *
 * Skipped unless GEMINI_API_KEY is set, so the normal suite + CI never hit the network:
 *   GEMINI_API_KEY=$(op read "op://Agent Secrets/Gemini API Key/credential") \
 *     npx vitest run src/ai/tools/gemini.e2e.test.ts --config vitest.config.mts
 */
import { describe, it, expect } from "vitest";
import { buildChatBody, parseChatResponse } from "./providerToolMapping";
import { runToolLoop, type ToolEntry } from "./runToolLoop";
import { validateValue } from "./jsonSchemaValidator";
import type { NormalizedChatRequest } from "./NormalizedTools";

const KEY = process.env.GEMINI_API_KEY;
// Gemini 3.x. Default to flash: the *pro* tier has 0 free-tier quota (HTTP 429) on
// many keys, while flash is reachable (though it can be slow / 503 under load — hence
// the generous per-test timeouts below). Override with GEMINI_E2E_MODEL.
const MODEL = process.env.GEMINI_E2E_MODEL ?? "gemini-3-flash-preview";

async function geminiDispatch(req: NormalizedChatRequest) {
	const body = buildChatBody("gemini", MODEL, req);
	const url = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${KEY}`;
	const res = await fetch(url, {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify(body),
	});
	const json = (await res.json()) as Record<string, unknown>;
	if (!res.ok) throw new Error(`Gemini ${res.status}: ${JSON.stringify(json)}`);
	return parseChatResponse("gemini", json);
}

describe.skipIf(!KEY)("Gemini live wire (e2e)", () => {
	it("runs a real tool-calling loop end-to-end (functionCall/functionResponse + thoughtSignature echo)", async () => {
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
			dispatch: (req) => geminiDispatch(req),
			getTool: (name) => (name === "add" ? add : undefined),
			confirm: async () => true,
			validateArgs: (tool, args) => validateValue(args, tool.definition.parameters),
			isAbortError: () => false,
		});

		expect(calls.length).toBeGreaterThanOrEqual(1);
		expect(calls[0]).toEqual({ a: 17, b: 25 });
		expect(res.text).toMatch(/42/);
		expect(res.finishReason).toBe("stop");
	}, 120000);

	it("returns schema-constrained structured output (responseSchema)", async () => {
		const schema = {
			type: "object" as const,
			properties: {
				title: { type: "string" as const },
				tags: { type: "array" as const, items: { type: "string" as const } },
			},
			required: ["title", "tags"],
		};
		const parsed = await geminiDispatch({
			messages: [
				{ role: "user", content: "Extract the title and the tags (without '#') from this note: 'Hello World #alpha #beta'." },
			],
			responseFormat: { schema, name: "note_meta", strict: true },
		});
		const obj = JSON.parse(parsed.content) as { title: string; tags: string[] };
		expect(validateValue(obj, schema)).toBeNull();
		expect(typeof obj.title).toBe("string");
		expect(obj.tags).toEqual(expect.arrayContaining(["alpha", "beta"]));
	}, 120000);
});
