import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AIProvider, Model } from "./Provider";

// Finding: ai-assistant-disable-online-features — the "online features disabled"
// guard in OpenAIRequest hardcoded the provider name ("Blocking request to
// OpenAI: ...") even when the request targeted Anthropic/Gemini/a custom
// provider. The fix makes the message provider-neutral, matching the sibling
// chatRequest guard already in this file.

import { storeState, mocks, makeApp } from "../../tests/helpers/ai/requestHarness";

const { requestUrlMock } = mocks;

const { OpenAIRequest } = await import("./OpenAIRequest");

const anthropicModel: Model = { name: "claude-3-5-sonnet", maxTokens: 200000 };
const anthropicProvider = {
	name: "Anthropic",
	endpoint: "https://api.anthropic.com",
} as AIProvider;

describe("OpenAIRequest disable-online-features guard wording", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		storeState.disableOnlineFeatures = false;
	});

	it("uses a provider-neutral block message and never sends the request", async () => {
		storeState.disableOnlineFeatures = true;

		// Even for a non-OpenAI model, the guard must not name OpenAI.
		const makeRequest = OpenAIRequest(
			makeApp(),
			"key",
			anthropicModel,
			anthropicProvider,
			"system"
		);

		await expect(makeRequest("prompt")).rejects.toThrow(
			"Blocking request: Online features are disabled in settings."
		);
		await expect(makeRequest("prompt")).rejects.not.toThrow(/OpenAI/);
		expect(requestUrlMock).not.toHaveBeenCalled();
	});
});
