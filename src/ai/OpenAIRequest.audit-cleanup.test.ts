import { beforeEach, describe, expect, it, vi } from "vitest";
import type { App } from "obsidian";
import type { AIProvider, Model } from "./Provider";

// Finding: ai-assistant-disable-online-features — the "online features disabled"
// guard in OpenAIRequest hardcoded the provider name ("Blocking request to
// OpenAI: ...") even when the request targeted Anthropic/Gemini/a custom
// provider. The fix makes the message provider-neutral, matching the sibling
// chatRequest guard already in this file.

const storeState = vi.hoisted(() => ({
	disableOnlineFeatures: false,
}));

const mocks = vi.hoisted(() => ({
	requestUrlMock: vi.fn(),
	beginAIRequestLogEntryMock: vi.fn(),
	finishAIRequestLogEntryMock: vi.fn(),
	getModelProviderMock: vi.fn(),
	logMessageMock: vi.fn(),
	logErrorMock: vi.fn(),
}));

vi.mock("obsidian", () => ({
	requestUrl: mocks.requestUrlMock,
}));

vi.mock("src/settingsStore", () => ({
	settingsStore: {
		getState: () => storeState,
	},
}));

vi.mock("./AIAssistant", () => ({
	beginAIRequestLogEntry: mocks.beginAIRequestLogEntryMock,
	finishAIRequestLogEntry: mocks.finishAIRequestLogEntryMock,
}));

vi.mock("./aiHelpers", () => ({
	getModelProvider: mocks.getModelProviderMock,
}));

vi.mock("src/logger/logManager", () => ({
	log: {
		logMessage: mocks.logMessageMock,
		logError: mocks.logErrorMock,
	},
}));

const { requestUrlMock } = mocks;

const { OpenAIRequest } = await import("./OpenAIRequest");

// A minimal app whose activeEditor is undefined so preventCursorChange is a no-op.
function makeApp(): App {
	return {
		workspace: {
			activeEditor: undefined,
		},
	} as unknown as App;
}

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
