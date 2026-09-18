/**
 * REAL-CALL e2e for the #714 wire against the live OpenAI API. Exercises the actual
 * pure modules (providerToolMapping.buildChatBody/parseChatResponse + runToolLoop +
 * jsonSchemaValidator) end-to-end — the layer the prototype could only mock.
 *
 * Skipped unless OPENAI_API_KEY is set, so the normal suite + CI never hit the network:
 *   OPENAI_API_KEY=$(op read "op://Agent Secrets/OpenAI API Key/credential") \
 *     npx vitest run src/ai/tools/openai.e2e.test.ts --config vitest.config.mts
 */
import { describe } from "vitest";
import { liveWireCases } from "../../../tests/helpers/ai/liveWireCases";
import { buildChatBody, parseChatResponse } from "./providerToolMapping";
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
	liveWireCases(openaiDispatch, {
		toolLoop: "runs a real tool-calling loop end-to-end",
		structured: "returns schema-constrained structured output",
	}, 60000);
});
