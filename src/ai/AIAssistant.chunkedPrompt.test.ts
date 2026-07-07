import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { AIProvider } from "./Provider";
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
		provider: {
			name: "TestProvider",
			endpoint: "https://example.test/v1",
			apiKey: "",
			models: [],
			modelSource: "providerApi",
		} as AIProvider,
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
		// Overhead-heavy template: the rendered template alone exceeds the model's
		// entire context window (read straight off the model), so no completion
		// could ever fit.
		const overheadFormatter = vi.fn(
			async () => "static prompt overhead that consumes the whole model budget"
		);

		await expect(
			ChunkedPrompt(
				makeApp(),
				makeSettings({ model: { name: "test-model", maxTokens: 10 } }),
				overheadFormatter
			)
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

	// The merge path used to reassemble chunks with `combinedChunk += chunk`,
	// dropping the separator that split() consumed - "Line one\nLine two"
	// reached the model as "Line oneLine two" (words glued across every line
	// boundary) on the DEFAULT shouldMerge path. The consumed separators are
	// now retained and re-inserted between merged chunks.
	it("re-inserts the consumed separator between merged chunks", async () => {
		await ChunkedPrompt(
			makeApp(),
			makeSettings({
				text: "Line one\nLine two",
				shouldMerge: true,
				chunkSeparator: /\n/g,
			}),
			chunkFormatter
		);

		const sentPrompts = mocks.makeRequest.mock.calls.map(
			([prompt]) => prompt as string
		);
		expect(sentPrompts).toEqual(["Chunk: Line one\nLine two"]);
	});

	it("preserves paragraph boundaries (empty chunks) when merging", async () => {
		await ChunkedPrompt(
			makeApp(),
			makeSettings({
				text: "A\n\nB",
				shouldMerge: true,
				chunkSeparator: /\n/g,
			}),
			chunkFormatter
		);

		const sentPrompts = mocks.makeRequest.mock.calls.map(
			([prompt]) => prompt as string
		);
		expect(sentPrompts).toEqual(["Chunk: A\n\nB"]);
	});

	it("re-inserts a custom string separator between merged chunks", async () => {
		await ChunkedPrompt(
			makeApp(),
			makeSettings({
				text: "first---second",
				shouldMerge: true,
				chunkSeparator: "---" as unknown as RegExp,
			}),
			chunkFormatter
		);

		const sentPrompts = mocks.makeRequest.mock.calls.map(
			([prompt]) => prompt as string
		);
		expect(sentPrompts).toEqual(["Chunk: first---second"]);
	});

	// A separator with capturing groups already interleaves its captures into
	// the chunk list (historical String.split behavior); no extra boundary must
	// be re-inserted on top of that.
	it("keeps capture-group separators unchanged (captures already survive as chunks)", async () => {
		await ChunkedPrompt(
			makeApp(),
			makeSettings({
				text: "a\nb",
				shouldMerge: true,
				chunkSeparator: /(\n)/g,
			}),
			chunkFormatter
		);

		const sentPrompts = mocks.makeRequest.mock.calls.map(
			([prompt]) => prompt as string
		);
		expect(sentPrompts).toEqual(["Chunk: a\nb"]);
	});

	// The group-count probe must carry the separator's own flags: u-only
	// syntax like a code-point class range parses ONLY under /u, and a
	// flagless probe would throw a SyntaxError that fails the whole chunked
	// prompt for previously-working separators.
	it("supports u-flag-only separator syntax", async () => {
		await ChunkedPrompt(
			makeApp(),
			makeSettings({
				text: "one\u{1F600}two",
				shouldMerge: true,
				chunkSeparator: /[\u{1F600}-\u{1F64F}]/gu,
			}),
			chunkFormatter
		);

		const sentPrompts = mocks.makeRequest.mock.calls.map(
			([prompt]) => prompt as string
		);
		// The emoji separator is retained and re-inserted between merged chunks.
		expect(sentPrompts).toEqual(["Chunk: one\u{1F600}two"]);
	});

	// A `\1` in a group-free pattern is a legacy octal escape (matches U+0001);
	// wrapping it in a capture group would turn it into a backreference and
	// change the split points. Such separators stay on the historical
	// separator-discarding path, keeping chunk boundaries identical to split().
	it("keeps octal-escape separators on the historical path", async () => {
		await ChunkedPrompt(
			makeApp(),
			makeSettings({
				text: "z a\x01z tail",
				shouldMerge: true,
				// Built via the constructor: TS rejects the /a\1/ literal form
				// (TS1534) for exactly the ambiguity this test pins down.
				chunkSeparator: new RegExp("a\\1", "g"),
			}),
			chunkFormatter
		);

		const sentPrompts = mocks.makeRequest.mock.calls.map(
			([prompt]) => prompt as string
		);
		// Same chunks as "z a\x01z tail".split(/a\1/g) = ["z ", "z tail"],
		// merged without separator re-insertion (historical behavior).
		expect(sentPrompts).toEqual(["Chunk: z z tail"]);
	});

	// Re-inserted joiners must be budgeted at their real estimated size (the
	// historical flat +1 only covered the default "\n"): a long separator
	// would otherwise be re-inserted uncounted and blow a merged request far
	// past maxChunkTokens.
	it("budgets long re-inserted separators instead of a flat +1", async () => {
		// Each line is 20 chars (~5 tokens); the separator is 27 chars (7
		// tokens). Budget 16: one line + one separator + one line = 5+7+5 = 17
		// > 16, so each line must go in its OWN request. Under the old flat +1
		// accounting two lines merged (6+6 = 12 < 16) and the request carried
		// ~17 estimated tokens against the 16-token budget.
		const line = "aaaaaaaaaaaaaaaaaaaa";
		const sep = "\n===CHUNK-BOUNDARY===\n\n\n\n\n\n";
		await ChunkedPrompt(
			makeApp(),
			makeSettings({
				text: [line, line, line].join(sep),
				maxChunkTokens: 16,
				shouldMerge: true,
				chunkSeparator: sep as unknown as RegExp,
			}),
			chunkFormatter
		);

		const sentPrompts = mocks.makeRequest.mock.calls.map(
			([prompt]) => prompt as string
		);
		expect(sentPrompts).toEqual([
			`Chunk: ${line}`,
			`Chunk: ${line}`,
			`Chunk: ${line}`,
		]);
	});

	// The boundary between two MERGED REQUESTS is genuinely consumed: the
	// separator belongs to neither request. Grouping (request count) must be
	// unchanged by separator retention.
	it("does not leak a separator across a merge-group boundary", async () => {
		// budget 8 tokens ≈ 32 chars per merged group; each line is 20 chars, so
		// exactly one line fits per group → 3 requests, none starting with \n.
		const line = "aaaaaaaaaaaaaaaaaaaa";
		await ChunkedPrompt(
			makeApp(),
			makeSettings({
				text: [line, line, line].join("\n"),
				maxChunkTokens: 8,
				shouldMerge: true,
				chunkSeparator: /\n/g,
			}),
			chunkFormatter
		);

		const sentPrompts = mocks.makeRequest.mock.calls.map(
			([prompt]) => prompt as string
		);
		expect(sentPrompts).toEqual([
			`Chunk: ${line}`,
			`Chunk: ${line}`,
			`Chunk: ${line}`,
		]);
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
