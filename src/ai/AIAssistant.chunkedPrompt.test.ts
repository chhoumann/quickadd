import { beforeEach, describe, expect, it, vi } from "vitest";
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
	isLikelyContextLimitError: mocks.isLikelyContextLimitError,
}));

vi.mock("./aiHelpers", () => ({
	getModelMaxTokens: mocks.getModelMaxTokens,
}));

const { ChunkedPrompt } = await import("./AIAssistant");

vi.stubGlobal("sleep", async () => {});

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
		promptTemplate: "Chunk: {{chunk}}",
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

describe("ChunkedPrompt", () => {
	it("splits over-budget chunks by estimate before sending", async () => {
		const formatter = vi.fn(async (_template: string, variables) =>
			variables.chunk === " " ? "Chunk: " : `Chunk: ${variables.chunk}`
		);

		await ChunkedPrompt(
			makeApp(),
			makeSettings({
				text: "alpha beta gamma delta epsilon zeta eta theta",
				maxChunkTokens: 8,
				shouldMerge: false,
			}),
			formatter
		);

		const sentPrompts = mocks.makeRequest.mock.calls.map(([prompt]) => prompt);
		expect(sentPrompts.length).toBeGreaterThan(1);
		expect(sentPrompts.join("")).toContain("alpha");
		expect(sentPrompts.join("")).toContain("delta");
	});

	it("throws before dispatch when prompt overhead leaves no usable chunk budget", async () => {
		mocks.getModelMaxTokens.mockReturnValue(20);
		const formatter = vi.fn(async (_template: string, variables) =>
			variables.chunk === " "
				? "static prompt overhead that consumes most of the model budget"
				: `Chunk: ${variables.chunk}`
		);

		await expect(
			ChunkedPrompt(makeApp(), makeSettings(), formatter)
		).rejects.toThrow("too little room for text chunks");
		expect(mocks.makeRequest).not.toHaveBeenCalled();
	});

	it("splits and retries a chunk when the provider rejects it for context length", async () => {
		const formatter = vi.fn(async (_template: string, variables) =>
			variables.chunk === " " ? "Chunk: " : `Chunk: ${variables.chunk}`
		);

		mocks.makeRequest.mockImplementation(async (prompt: string) => {
			if (prompt === "Chunk: alpha beta") {
				throw new Error("maximum context length exceeded");
			}

			return response(`response:${prompt}`);
		});

		const result = await ChunkedPrompt(makeApp(), makeSettings(), formatter);

		expect(result.output).toBe("response:Chunk: alpha |response:Chunk: beta");
		expect(mocks.makeRequest).toHaveBeenCalledTimes(3);
		expect(mocks.makeRequest).toHaveBeenNthCalledWith(1, "Chunk: alpha beta");
		expect(mocks.makeRequest).toHaveBeenNthCalledWith(2, "Chunk: alpha ");
		expect(mocks.makeRequest).toHaveBeenNthCalledWith(3, "Chunk: beta");
	});

	it("does not split non-context provider errors", async () => {
		const formatter = vi.fn(async (_template: string, variables) =>
			variables.chunk === " " ? "Chunk: " : `Chunk: ${variables.chunk}`
		);
		mocks.makeRequest.mockRejectedValue(new Error("network down"));

		await expect(
			ChunkedPrompt(makeApp(), makeSettings(), formatter)
		).rejects.toThrow("network down");
		expect(mocks.makeRequest).toHaveBeenCalledTimes(1);
	});
});
