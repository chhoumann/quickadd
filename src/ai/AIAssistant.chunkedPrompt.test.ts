import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { App } from "obsidian";
import type { CommonResponse } from "./OpenAIRequest";

const storeState = vi.hoisted(() => ({
	disableOnlineFeatures: false,
}));

const mocks = vi.hoisted(() => ({
	makeRequest: vi.fn(),
	openAIRequest: vi.fn(),
	isLikelyContextLimitError: vi.fn(),
	getModelMaxTokens: vi.fn(),
}));

vi.mock("src/settingsStore", () => ({
	settingsStore: {
		getState: () => storeState,
	},
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

const { ChunkedPrompt } = await import("./AIAssistant");

vi.stubGlobal("sleep", async () => {});

afterAll(() => {
	vi.unstubAllGlobals();
});

function makeApp(): App {
	return {} as App;
}

function response(content: string): CommonResponse {
	return {
		id: content,
		model: "test-model",
		content,
		usage: {
			promptTokens: 1,
			completionTokens: 1,
			totalTokens: 2,
		},
		stopReason: "stop",
		stopSequence: null,
		created: Date.now(),
	};
}

function makeSettings(overrides: Partial<Parameters<typeof ChunkedPrompt>[1]> = {}) {
	return {
		apiKey: "key",
		model: { name: "test-model", maxTokens: 1000 },
		outputVariableName: "output",
		showAssistantMessages: false,
		systemPrompt: "system",
		modelOptions: {},
		text: "alpha beta",
		promptTemplate: "Chunk: {{VALUE:chunk}}",
		chunkSeparator: /\n/g,
		resultJoiner: "|",
		shouldMerge: true,
		...overrides,
	};
}

beforeEach(() => {
	vi.clearAllMocks();
	storeState.disableOnlineFeatures = false;
	mocks.openAIRequest.mockReturnValue(mocks.makeRequest);
	mocks.isLikelyContextLimitError.mockImplementation((error: unknown) =>
		error instanceof Error && /context/i.test(error.message)
	);
	mocks.getModelMaxTokens.mockReturnValue(1000);
	mocks.makeRequest.mockImplementation(async (prompt: string) =>
		response(`response:${prompt}`)
	);
});

// Prompts are produced by the formatter (serialized), one call per chunk, so a
// simple interpolating formatter is all most of these tests need.
const chunkFormatter = vi.fn(
	async (_template: string, variables: { [k: string]: unknown }) =>
		`Chunk: ${variables.chunk}`
);

describe("ChunkedPrompt", () => {
	it("splits over-budget chunks by estimate before sending", async () => {
		await ChunkedPrompt(
			makeApp(),
			makeSettings({
				text: "alpha beta gamma delta epsilon zeta eta theta",
				maxChunkTokens: 8,
				shouldMerge: false,
			}),
			chunkFormatter
		);

		const sentPrompts = mocks.makeRequest.mock.calls.map(([prompt]) => prompt);
		expect(sentPrompts.length).toBeGreaterThan(1);
		expect(sentPrompts.join("")).toContain("alpha");
		expect(sentPrompts.join("")).toContain("delta");
	});

	it("throws before dispatch when prompt overhead exceeds the whole context window", async () => {
		mocks.getModelMaxTokens.mockReturnValue(10);
		// Overhead-heavy template: the rendered template alone exceeds the model's
		// entire context window, so no completion could ever fit.
		const overheadFormatter = vi.fn(
			async () => "static prompt overhead that consumes the whole model budget"
		);

		await expect(
			ChunkedPrompt(makeApp(), makeSettings(), overheadFormatter)
		).rejects.toThrow(/exceeds the model's entire context window/);
		expect(mocks.makeRequest).not.toHaveBeenCalled();
	});

	it("splits and retries a chunk when the provider rejects it for context length", async () => {
		mocks.makeRequest.mockImplementation(async (prompt: string) => {
			if (prompt === "Chunk: alpha beta") {
				throw new Error("maximum context length exceeded");
			}

			return response(`response:${prompt}`);
		});

		const result = await ChunkedPrompt(
			makeApp(),
			makeSettings(),
			chunkFormatter
		);

		expect(result.output).toBe("response:Chunk: alpha |response:Chunk: beta");
		expect(mocks.makeRequest).toHaveBeenCalledTimes(3);
		expect(mocks.makeRequest).toHaveBeenNthCalledWith(1, "Chunk: alpha beta");
		expect(mocks.makeRequest).toHaveBeenNthCalledWith(2, "Chunk: alpha ");
		expect(mocks.makeRequest).toHaveBeenNthCalledWith(3, "Chunk: beta");
	});

	it("does not split non-context provider errors", async () => {
		mocks.makeRequest.mockRejectedValue(new Error("network down"));

		await expect(
			ChunkedPrompt(makeApp(), makeSettings(), chunkFormatter)
		).rejects.toThrow("network down");
		expect(mocks.makeRequest).toHaveBeenCalledTimes(1);
	});

	// Finding #1 (regression): the formatter must not be re-entered concurrently.
	// A formatter that mutates a shared variables map (as the real quickAddApi
	// formatter does) would otherwise let concurrent chunks overwrite each other's
	// `chunk` value before it is read.
	it("renders each chunk into its own prompt even with a shared-map formatter", async () => {
		const shared = { chunk: "" };
		const sharedMapFormatter = vi.fn(
			async (_template: string, variables: { [k: string]: unknown }) => {
				shared.chunk = String(variables.chunk);
				// Async work between write and read — a sibling render would
				// overwrite shared.chunk here if the formatter were re-entered.
				await Promise.resolve();
				await Promise.resolve();
				return `Chunk: ${shared.chunk}`;
			}
		);

		await ChunkedPrompt(
			makeApp(),
			makeSettings({
				text: "alpha\nbeta",
				chunkSeparator: /\n/g,
				shouldMerge: false,
			}),
			sharedMapFormatter
		);

		const sentPrompts = mocks.makeRequest.mock.calls.map(
			([prompt]) => prompt as string
		);
		expect(new Set(sentPrompts)).toEqual(
			new Set(["Chunk: alpha", "Chunk: beta"])
		);
	});

	// Finding #9 (regression): a tiny-context model with tiny input must not be
	// rejected locally — the provider is the source of truth.
	it("attempts tiny input on a tiny-context model instead of failing locally", async () => {
		mocks.getModelMaxTokens.mockReturnValue(16);

		await ChunkedPrompt(
			makeApp(),
			makeSettings({
				systemPrompt: "",
				text: "ok",
				promptTemplate: "{{VALUE:chunk}}",
			}),
			chunkFormatter
		);

		expect(mocks.makeRequest.mock.calls.length).toBeGreaterThanOrEqual(1);
	});

	// Finding #4 (regression): a separator-poor over-budget input must bail via the
	// safety cap (during splitting) without dispatching any provider request.
	it("bails via the safety cap without dispatching for over-budget input", async () => {
		await expect(
			ChunkedPrompt(
				makeApp(),
				makeSettings({
					text: "a".repeat(4000),
					maxChunkTokens: 1,
					shouldMerge: false,
					chunkSeparator: /\n/g,
				}),
				chunkFormatter
			)
		).rejects.toThrow(/safety limit/i);
		expect(mocks.makeRequest).not.toHaveBeenCalled();
	});

	// Iter-2 regression: the cap must count FINAL (post-merge) prompts, not raw
	// pre-merge line fragments. Many short lines should merge into a few prompts.
	it("merges many short lines into a few prompts instead of hitting the cap", async () => {
		const text = Array.from({ length: 501 }, () => "x").join("\n");

		const result = await ChunkedPrompt(
			makeApp(),
			makeSettings({ text, shouldMerge: true, chunkSeparator: /\n/g }),
			chunkFormatter
		);

		expect(result.output).toBeDefined();
		const calls = mocks.makeRequest.mock.calls.length;
		expect(calls).toBeGreaterThanOrEqual(1);
		expect(calls).toBeLessThan(501);
	});

	// Iter-2 consensus regression: VALUE modifiers (e.g. case:upper) must apply to
	// the real chunk value — the previous sentinel approach sent the placeholder.
	it("applies VALUE modifiers to each chunk's real text", async () => {
		const upperCasingFormatter = vi.fn(
			async (_template: string, variables: { [k: string]: unknown }) =>
				`Slug: ${String(variables.chunk).toUpperCase()}`
		);

		await ChunkedPrompt(
			makeApp(),
			makeSettings({
				text: "alpha\nbeta",
				promptTemplate: "Slug: {{VALUE:chunk|case:upper}}",
				chunkSeparator: /\n/g,
				shouldMerge: false,
			}),
			upperCasingFormatter
		);

		const sentPrompts = mocks.makeRequest.mock.calls.map(
			([prompt]) => prompt as string
		);
		expect(new Set(sentPrompts)).toEqual(
			new Set(["Slug: ALPHA", "Slug: BETA"])
		);
	});

	// Iter-2 regression: fail fast when the template can't reference the chunk,
	// rather than silently sending the same chunk-less prompt for every chunk.
	it("throws when the template does not reference the chunk", async () => {
		await expect(
			ChunkedPrompt(
				makeApp(),
				makeSettings({ promptTemplate: "Summarize the document." }),
				chunkFormatter
			)
		).rejects.toThrow(/does not reference the chunk/);
		expect(mocks.makeRequest).not.toHaveBeenCalled();
	});

	// Iter-3 regression: a similarly-named but distinct variable is not the chunk.
	it("throws when the template references a different variable, not chunk", async () => {
		await expect(
			ChunkedPrompt(
				makeApp(),
				makeSettings({ promptTemplate: "Summarize {{VALUE:chunk-id}}" }),
				chunkFormatter
			)
		).rejects.toThrow(/does not reference the chunk/);
		expect(mocks.makeRequest).not.toHaveBeenCalled();
	});

	// Iter-4 regression: a dynamic token alone is not enough to prove the chunk is
	// inserted. The rendered prompt must include the injected chunk value.
	it("throws when a dynamic token renders a prompt without the chunk", async () => {
		const dynamicFormatter = vi.fn(async () => "Summarize today's notes.");

		await expect(
			ChunkedPrompt(
				makeApp(),
				makeSettings({ promptTemplate: "Summarize {{MACRO:today}}" }),
				dynamicFormatter
			)
		).rejects.toThrow(/does not reference the chunk/);
		expect(mocks.makeRequest).not.toHaveBeenCalled();
	});

	it("allows a dynamic token when rendering injects the chunk value", async () => {
		const dynamicFormatter = vi.fn(
			async (_template: string, variables: { [k: string]: unknown }) =>
				`Dynamic: ${variables.chunk}`
		);

		await ChunkedPrompt(
			makeApp(),
			makeSettings({
				text: "alpha\nbeta",
				promptTemplate: "{{MACRO:chunk-template}}",
				chunkSeparator: /\n/g,
				shouldMerge: false,
			}),
			dynamicFormatter
		);

		const sentPrompts = mocks.makeRequest.mock.calls.map(
			([prompt]) => prompt as string
		);
		expect(new Set(sentPrompts)).toEqual(
			new Set(["Dynamic: alpha", "Dynamic: beta"])
		);
	});

	it("allows a dynamic token when rendering injects a transformed chunk value", async () => {
		const dynamicFormatter = vi.fn(
			async (_template: string, variables: { [k: string]: unknown }) =>
				`Dynamic: ${String(variables.chunk).toUpperCase()}`
		);

		await ChunkedPrompt(
			makeApp(),
			makeSettings({
				text: "alpha\nbeta",
				promptTemplate: "{{MACRO:chunk-template}}",
				chunkSeparator: /\n/g,
				shouldMerge: false,
			}),
			dynamicFormatter
		);

		const sentPrompts = mocks.makeRequest.mock.calls.map(
			([prompt]) => prompt as string
		);
		expect(new Set(sentPrompts)).toEqual(
			new Set(["Dynamic: ALPHA", "Dynamic: BETA"])
		);
	});

	// Iter-3 regression (high): a formatter failure on one chunk must trip the
	// terminal-failure gate so sibling chunks stop instead of dispatching.
	it("stops sibling chunks when a formatter render fails", async () => {
		const failingFormatter = vi.fn(
			async (_template: string, variables: { [k: string]: unknown }) => {
				if (variables.chunk === "beta") throw new Error("macro blew up");
				return `Chunk: ${variables.chunk}`;
			}
		);

		await expect(
			ChunkedPrompt(
				makeApp(),
				makeSettings({
					text: "alpha\nbeta\ngamma",
					chunkSeparator: /\n/g,
					shouldMerge: false,
				}),
				failingFormatter
			)
		).rejects.toThrow("macro blew up");

		// gamma must not dispatch after beta's render failed terminally.
		expect(mocks.makeRequest.mock.calls.length).toBeLessThan(3);
	});
});
