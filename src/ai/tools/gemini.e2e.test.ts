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
import { describe } from "vitest";
import { liveWireCases } from "../../../tests/helpers/ai/liveWireCases";
import { buildChatBody, parseChatResponse } from "./providerToolMapping";
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
	liveWireCases(geminiDispatch, {
		toolLoop: "runs a real tool-calling loop end-to-end (functionCall/functionResponse + thoughtSignature echo)",
		structured: "returns schema-constrained structured output (responseSchema)",
	}, 120000);
});
