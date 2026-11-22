import { beforeEach, describe, expect, it, vi } from "vitest";
import { TFile } from "obsidian";
import type { App } from "obsidian";
import type { AIProvider } from "./Provider";

/**
 * The invariant behind #1565 / #1568: the AI system prompt is sent to the model
 * VERBATIM. Only the prompt (or prompt template) goes through the formatter.
 *
 * Three modals used to claim otherwise - a live preview resolving the tokens
 * plus a `{{` autocomplete offering them - so `{{DATE}}` previewed as a date and
 * then reached the model as eight literal characters. The affordance is gone;
 * this pins the behaviour it was lying about, in both directions:
 *
 *   - the system prompt arrives in the provider request byte-identical to the
 *     input, and
 *   - the formatter is never invoked with it.
 *
 * The agent's seed request is pinned the same way in tools/Agent.test.ts.
 *
 * If #1572 ever makes system prompts formattable, this test fails, and whoever
 * changes it is the person who should also restore the preview and the token
 * autocomplete in the old AI Assistant settings modal and AIAssistantCommandSettingsModal.
 * (A third modal, AIAssistantInfiniteCommandSettingsModal, carried the same
 * affordance; it went with the unreachable command type it configured, #1571.)
 */

const storeState = vi.hoisted(() => ({
	disableOnlineFeatures: false,
}));

const mocks = vi.hoisted(() => ({
	requestUrl: vi.fn(),
	getMarkdownFilesInFolder: vi.fn((): unknown[] => []),
}));

vi.mock("obsidian", async (importOriginal) => ({
	...(await importOriginal<object>()),
	requestUrl: mocks.requestUrl,
}));

vi.mock("src/settingsStore", () => ({
	settingsStore: { getState: () => storeState },
}));

vi.mock("src/utils/vaultQueries", () => ({
	getMarkdownFilesInFolder: mocks.getMarkdownFilesInFolder,
}));

const { runAIAssistant, Prompt } = await import("./AIAssistant");
const { ChunkedPrompt } = await import("./chunkedPrompt");

/** Contains every token shape the removed preview used to resolve on screen. */
const SYSTEM_PROMPT =
	"You are a helpful assistant. Today is {{DATE}} and the note is {{VALUE:title}}.";

function makeApp(): App {
	return { workspace: {} } as unknown as App;
}

/** An OpenAI-compatible chat completion that echoes the user message. */
function completion(userMessage: string) {
	return {
		id: "r",
		model: "test-model",
		created: 0,
		choices: [{ index: 0, message: { role: "assistant", content: `response:${userMessage}` }, finish_reason: "stop" }],
		usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
	};
}

type WireMessage = { role: string; content: string };

/** The chat messages of every request sent to the provider, in order. */
function sentRequests(): WireMessage[][] {
	return mocks.requestUrl.mock.calls.map(
		([request]) => (JSON.parse((request as { body: string }).body) as { messages: WireMessage[] }).messages,
	);
}

/** The system message of every request sent to the provider. */
function systemPromptsSent(): string[] {
	const requests = sentRequests();
	expect(requests.length).toBeGreaterThan(0);
	return requests.map((messages) => messages.find((m) => m.role === "system")?.content ?? "<none>");
}

function userMessagesSent(): string[] {
	return sentRequests().map((messages) => messages.find((m) => m.role === "user")?.content ?? "<none>");
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

beforeEach(() => {
	vi.clearAllMocks();
	storeState.disableOnlineFeatures = false;
	mocks.requestUrl.mockImplementation(async (request: { body: string }) => {
		const { messages } = JSON.parse(request.body) as { messages: WireMessage[] };
		return { status: 200, json: completion(messages.at(-1)?.content ?? "") };
	});
});

describe("the AI system prompt is sent verbatim", () => {
	it("Prompt sends the system prompt unformatted while formatting the prompt", async () => {
		await Prompt(
			makeApp(),
			{ ...baseSettings(), prompt: "Summarise {{VALUE:body}}" },
			resolvingFormatter,
		);

		expect(systemPromptsSent()).toEqual([SYSTEM_PROMPT]);
		// The prompt IS formatted - this is the contrast that makes the system
		// prompt's exemption a deliberate behaviour rather than a dead code path.
		expect(userMessagesSent()).toEqual(["Summarise RESOLVED"]);
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

		const systemPrompts = systemPromptsSent();
		expect(systemPrompts.length).toBeGreaterThan(1);
		expect(new Set(systemPrompts)).toEqual(new Set([SYSTEM_PROMPT]));
	});

	it("runAIAssistant formats the prompt TEMPLATE and leaves the system prompt alone", async () => {
		// The macro AI Assistant command's path, i.e. the modal that lost its
		// preview. Covered explicitly because a partial #1572 implementation could
		// format here and nowhere else, leaving a field that IS formatted with a
		// note under it saying it is not.
		const template = new TFile();
		template.path = "Prompts/Summarise.md";
		template.basename = "Summarise";
		mocks.getMarkdownFilesInFolder.mockReturnValue([template]);

		const app = {
			workspace: {},
			vault: {
				getAbstractFileByPath: () => template,
				cachedRead: async () => "Summarise {{VALUE:body}}",
			},
		} as unknown as App;

		await runAIAssistant(
			app,
			{
				...baseSettings(),
				promptTemplate: { enable: true, name: "Summarise.md" },
				promptTemplateFolder: "Prompts",
			},
			resolvingFormatter,
		);

		expect(systemPromptsSent()).toEqual([SYSTEM_PROMPT]);
		expect(userMessagesSent()).toEqual(["Summarise RESOLVED"]);
		expect(resolvingFormatter).toHaveBeenCalledTimes(1);
		expect(resolvingFormatter).not.toHaveBeenCalledWith(SYSTEM_PROMPT);
	});

	it("keeps the token characters intact rather than stripping them", async () => {
		await Prompt(
			makeApp(),
			{ ...baseSettings(), prompt: "hello" },
			resolvingFormatter,
		);

		// The specific failure mode the removed preview hid: authors saw a date and
		// the model saw the eight characters.
		expect(systemPromptsSent()[0]).toContain("{{DATE}}");
	});
});
