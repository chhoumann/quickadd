/**
 * REAL-CALL e2e for the #714 wire against the live OpenAI API. Exercises the actual
 * pure modules (providerToolMapping.buildChatBody/parseChatResponse + runToolLoop +
 * jsonSchemaValidator) end-to-end — the layer the prototype could only mock.
 *
 * Two wires, matching getChatWire: OpenAI's own endpoint gets the Responses API
 * (/v1/responses), and OpenAI-compatible endpoints get Chat Completions, exercised
 * here against OpenAI's own Chat Completions as the reference implementation.
 *
 * Skipped unless OPENAI_API_KEY is set, so the normal suite + CI never hit the network:
 *   OPENAI_API_KEY=$(op read "op://Agent Secrets/OpenAI API Key/credential") \
 *     npx vitest run src/ai/tools/openai.e2e.test.ts --config vitest.config.mts
 */
import { describe } from "vitest";
import { liveWireCases } from "../../../tests/helpers/ai/liveWireCases";
import type { ChatWire } from "../Provider";
import { buildChatBody, parseChatResponse } from "./providerToolMapping";
import type { NormalizedChatRequest } from "./NormalizedTools";

const KEY = process.env.OPENAI_API_KEY;
// Responses API default: a current reasoning model. gpt-6-* and gpt-5.6-* reason by
// default, which Chat Completions rejects alongside function tools; the Responses
// API accepts both. Override with OPENAI_E2E_MODEL to target a specific model.
const MODEL = process.env.OPENAI_E2E_MODEL ?? "gpt-6-luna";
// Chat Completions default: a model that accepts function tools there as-is.
// Override with OPENAI_E2E_CHAT_MODEL.
const CHAT_MODEL = process.env.OPENAI_E2E_CHAT_MODEL ?? "gpt-5-mini";

function dispatcher(wire: ChatWire, model: string, path: string) {
	return async (req: NormalizedChatRequest) => {
		const body = buildChatBody(wire, model, req);
		const res = await fetch(`https://api.openai.com/v1${path}`, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: `Bearer ${KEY}`,
			},
			body: JSON.stringify(body),
		});
		const json = (await res.json()) as Record<string, unknown>;
		if (!res.ok) throw new Error(`OpenAI ${res.status}: ${JSON.stringify(json)}`);
		return parseChatResponse(wire, json);
	};
}

describe.skipIf(!KEY)(`OpenAI Responses API live wire (e2e, ${MODEL})`, () => {
	liveWireCases(dispatcher("openai-responses", MODEL, "/responses"), {
		toolLoop: "runs a real tool-calling loop end-to-end",
		structured: "returns schema-constrained structured output",
	}, 60000);
});

describe.skipIf(!KEY)(`OpenAI Chat Completions live wire (e2e, ${CHAT_MODEL})`, () => {
	liveWireCases(dispatcher("openai", CHAT_MODEL, "/chat/completions"), {
		toolLoop: "runs a real tool-calling loop end-to-end",
		structured: "returns schema-constrained structured output",
	}, 60000);
});
