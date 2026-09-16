/**
 * REAL-CALL e2e for the #714 wire against the live Anthropic Messages API. Exercises
 * the actual pure modules (providerToolMapping.buildChatBody/parseChatResponse +
 * runToolLoop + jsonSchemaValidator) end-to-end against a current Claude 4.x model.
 *
 * Skipped unless ANTHROPIC_API_KEY is set, so the normal suite + CI never hit the network:
 *   ANTHROPIC_API_KEY=$(op read "op://Agent Secrets/Anthropic Claude API Key/credential") \
 *     npx vitest run src/ai/tools/anthropic.e2e.test.ts --config vitest.config.mts
 */
import { describe } from "vitest";
import { liveWireCases } from "../../../tests/helpers/ai/liveWireCases";
import { buildChatBody, parseChatResponse } from "./providerToolMapping";
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
	liveWireCases(anthropicDispatch, {
		toolLoop: "runs a real tool-calling loop end-to-end",
		structured: "returns schema-constrained structured output (native output_config.format)",
	}, 60000);
});
