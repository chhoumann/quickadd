import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { App } from "obsidian";
import type { AIProvider } from "./Provider";
import type { CommonResponse } from "./OpenAIRequest";

/**
 * The invariant behind #1565 / #1568: the AI system prompt is sent to the model
 * VERBATIM. Only the prompt (or prompt template) goes through the formatter.
 *
 * Three modals used to claim otherwise — a live preview resolving the tokens
 * plus a `{{` autocomplete offering them — so `{{DATE}}` previewed as a date and
 * then reached the model as eight literal characters. The affordance is gone;
 * this pins the behaviour it was lying about, in both directions:
 *
 *   - the system prompt arrives at OpenAIRequest byte-identical to the input, and
 *   - the formatter is never invoked with it.
 *
 * If #1572 ever makes system prompts formattable, this test fails, and whoever
 * changes it is the person who should also restore the preview and the token
 * autocomplete in AIAssistantSettingsModal / AIAssistantCommandSettingsModal /
 * AIAssistantInfiniteCommandSettingsModal.
 */

const storeState = vi.hoisted(() => ({
	disableOnlineFeatures: false,
}));

const mocks = vi.hoisted(() => ({
	makeRequest: vi.fn(),
	openAIRequest: vi.fn(),
	isLikelyContextLimitError: vi.fn(() => false),
	getModelMaxTokens: vi.fn(() => 100000),
	getMarkdownFilesInFolder: vi.fn(() => []),
}));

vi.mock("src/settingsStore", () => ({
	settingsStore: { getState: () => storeState },
}));

vi.mock("./OpenAIRequest", () => ({
	OpenAIRequest: mocks.openAIRequest,
}));

vi.mock("./providerErrors", () => ({
	isLikelyContextLimitError: mocks.isLikelyContextLimitError,
}));

vi.mock("./aiHelpers", () => ({
	getModelMaxTokens: mocks.getModelMaxTokens,
}));

vi.mock("src/utilityObsidian", () => ({
	getMarkdownFilesInFolder: mocks.getMarkdownFilesInFolder,
}));

const { Prompt, ChunkedPrompt } = await import("./AIAssistant");

vi.stubGlobal("sleep", async () => {});

afterAll(() => {
	vi.unstubAllGlobals();
});

/** Contains every token shape the removed preview used to resolve on screen. */
const SYSTEM_PROMPT =
	"You are a helpful assistant. Today is {{DATE}} and the note is {{VALUE:title}}.";

function makeApp(): App {
	return {} as App;
}

function response(content: string): CommonResponse {
	return {
		id: content,
		model: "test-model",
		content,
		usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
		stopReason: "stop",
		stopSequence: null,
		created: 0,
	};
}

function baseSettings() {
	return {
		apiKey: "key",
		model: { name: "test-model", maxTokens: 100000 },
		provider: {
			name: "TestProvider",
			endpoint: "https://example.test/v1",
			apiKey: "",
			models: [],
			modelSource: "providerApi",
		} as AIProvider,
		outputVariableName: "output",
		showAssistantMessages: false,
		systemPrompt: SYSTEM_PROMPT,
		modelOptions: {},
	};
}

/** Resolves every token, so an accidentally formatted system prompt is obvious. */
const resolvingFormatter = vi.fn(async (input: string) =>
	input.replace(/\{\{[^}]*\}\}/g, "RESOLVED"),
);

/** The `systemPrompt` argument OpenAIRequest was constructed with. */
function systemPromptSentToProvider(): unknown {
	expect(mocks.openAIRequest).toHaveBeenCalled();
	return mocks.openAIRequest.mock.calls[0][4];
}

beforeEach(() => {
	vi.clearAllMocks();
	storeState.disableOnlineFeatures = false;
	mocks.openAIRequest.mockReturnValue(mocks.makeRequest);
	mocks.getModelMaxTokens.mockReturnValue(100000);
	mocks.makeRequest.mockImplementation(async (prompt: string) =>
		response(`response:${prompt}`),
	);
});

describe("the AI system prompt is sent verbatim", () => {
	it("Prompt sends the system prompt unformatted while formatting the prompt", async () => {
		await Prompt(
			makeApp(),
			{ ...baseSettings(), prompt: "Summarise {{VALUE:body}}" },
			resolvingFormatter,
		);

		expect(systemPromptSentToProvider()).toBe(SYSTEM_PROMPT);
		// The prompt IS formatted — this is the contrast that makes the system
		// prompt's exemption a deliberate behaviour rather than a dead code path.
		expect(mocks.makeRequest).toHaveBeenCalledWith("Summarise RESOLVED");
		expect(resolvingFormatter).toHaveBeenCalledTimes(1);
		expect(resolvingFormatter).not.toHaveBeenCalledWith(SYSTEM_PROMPT);
	});

	it("ChunkedPrompt sends the system prompt unformatted on every chunk request", async () => {
		await ChunkedPrompt(
			makeApp(),
			{
				...baseSettings(),
				text: "alpha\nbeta",
				promptTemplate: "Chunk: {{VALUE:chunk}}",
				chunkSeparator: /\n/g,
				resultJoiner: "|",
				shouldMerge: false,
				maxChunkTokens: 8,
			},
			async (_template: string, variables: { [k: string]: unknown }) =>
				`Chunk: ${String(variables.chunk)}`,
		);

		// One OpenAIRequest is built for the whole run and reused per chunk, so
		// checking the constructor argument covers every dispatched request.
		expect(systemPromptSentToProvider()).toBe(SYSTEM_PROMPT);
		expect(mocks.makeRequest.mock.calls.length).toBeGreaterThan(0);
		for (const [prompt] of mocks.makeRequest.mock.calls) {
			expect(prompt).not.toContain("RESOLVED");
		}
	});

	it("keeps the token characters intact rather than stripping them", async () => {
		await Prompt(
			makeApp(),
			{ ...baseSettings(), prompt: "hello" },
			resolvingFormatter,
		);

		// The specific failure mode the removed preview hid: authors saw a date and
		// the model saw the eight characters.
		expect(systemPromptSentToProvider()).toContain("{{DATE}}");
	});
});
