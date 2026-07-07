import { describe, it, expect, vi, beforeEach } from "vitest";
import type { CommonResponse } from "../OpenAIRequest";

// --- Mock the Obsidian-coupled dependencies the Agent reaches for ---
const chatRequestMock = vi.fn<(...args: unknown[]) => Promise<CommonResponse>>();
vi.mock("../OpenAIRequest", () => ({
	chatRequest: (...args: unknown[]) => chatRequestMock(...args),
	anthropicMaxTokens: () => 8192,
}));

const confirmMock = vi.fn<() => Promise<string>>(async () => "allow");
vi.mock("../../gui/AIToolConfirmModal", () => ({
	default: { Prompt: () => confirmMock() },
}));

vi.mock("../../formatters/completeFormatter", () => ({
	CompleteFormatter: class {
		async formatFileContent(input: string) {
			return input; // identity — formatting is exercised elsewhere
		}
	},
}));

vi.mock("../aiHelpers", () => ({
	resolveModelInputOrThrow: (input: string | { name: string }) => ({
		model: {
			name: typeof input === "string" ? input : input.name,
			maxTokens: 128000,
		},
		provider: { name: "OpenAI", kind: "openai", endpoint: "https://x" },
	}),
}));

vi.mock("../providerSecrets", () => ({ resolveProviderApiKey: async () => "key" }));

vi.mock("../preventCursorChange", () => ({ preventCursorChange: () => () => {} }));

let mockSettings: Record<string, unknown>;
vi.mock("../../settingsStore", () => ({
	settingsStore: { getState: () => mockSettings },
}));

import { Agent } from "./Agent";
import type { AgentConfig } from "./aiToolTypes";

function makeAgent(config: Partial<AgentConfig> = {}, vars = new Map<string, unknown>()) {
	const choiceExecutor = { variables: vars } as never;
	return new Agent(
		{} as never,
		{} as never,
		choiceExecutor,
		{ model: "gpt-4o", ...config } as AgentConfig,
	);
}

function turnResponse(p: Partial<CommonResponse>): CommonResponse {
	return {
		id: "r",
		model: "gpt-4o",
		content: p.content ?? "",
		usage: p.usage ?? { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
		stopReason: p.stopReason ?? "",
		stopSequence: null,
		created: 0,
		toolCalls: p.toolCalls,
		normalizedStopReason: p.normalizedStopReason ?? (p.toolCalls?.length ? "tool_calls" : "stop"),
	};
}

function tool(extra: Record<string, unknown> = {}) {
	return {
		__qaTool: true as const,
		description: "create a note",
		inputSchema: { type: "object" as const, properties: { path: { type: "string" as const } }, required: ["path"] },
		execute: vi.fn(async () => "created"),
		...extra,
	};
}

beforeEach(() => {
	chatRequestMock.mockReset();
	confirmMock.mockReset();
	confirmMock.mockResolvedValue("allow");
	mockSettings = {
		disableOnlineFeatures: false,
		ai: { confirmToolCalls: "never", defaultSystemPrompt: "default sys" },
	};
});

describe("Agent.generate — tool loop", () => {
	it("runs a tool call then returns final text, mapping to the public shape", async () => {
		const t = tool();
		chatRequestMock
			.mockResolvedValueOnce(
				turnResponse({ toolCalls: [{ id: "c1", name: "create_note", args: { path: "a.md" } }] }),
			)
			.mockResolvedValueOnce(turnResponse({ content: "done", normalizedStopReason: "stop" }));

		const agent = makeAgent({ tools: { create_note: t } });
		const res = await agent.generate({ prompt: "make a note" });

		expect(t.execute).toHaveBeenCalledOnce();
		expect(res.text).toBe("done");
		// public 'output' naming on results
		const firstStep = res.steps[0];
		expect(firstStep.toolResults[0]).toMatchObject({ toolName: "create_note", output: "created", isError: false });
		expect(res.usage).toMatchObject({ inputTokens: expect.any(Number), outputTokens: expect.any(Number) });
	});

	it("denies a tool when the confirm modal returns deny → isError result, loop continues", async () => {
		confirmMock.mockResolvedValue("deny");
		mockSettings.ai = { confirmToolCalls: "always", defaultSystemPrompt: "" };
		const t = tool();
		chatRequestMock
			.mockResolvedValueOnce(turnResponse({ toolCalls: [{ id: "c1", name: "create_note", args: { path: "a.md" } }] }))
			.mockResolvedValueOnce(turnResponse({ content: "ok", normalizedStopReason: "stop" }));

		const agent = makeAgent({ tools: { create_note: t } });
		const res = await agent.generate({ prompt: "x" });
		expect(t.execute).not.toHaveBeenCalled();
		expect(res.steps[0].toolResults[0]).toMatchObject({ isError: true });
		expect(res.steps[0].toolResults[0].output).toMatch(/denied/);
	});

	it("aborts the whole run when the confirm modal returns abort", async () => {
		confirmMock.mockResolvedValue("abort");
		mockSettings.ai = { confirmToolCalls: "always", defaultSystemPrompt: "" };
		const t = tool();
		chatRequestMock.mockResolvedValueOnce(
			turnResponse({ toolCalls: [{ id: "c1", name: "create_note", args: { path: "a.md" } }] }),
		);
		const agent = makeAgent({ tools: { create_note: t } });
		await expect(agent.generate({ prompt: "x" })).rejects.toThrow(/aborted/i);
	});

	it("does not confirm a read-only tool under the 'destructive' setting", async () => {
		mockSettings.ai = { confirmToolCalls: "destructive", defaultSystemPrompt: "" };
		const t = tool({ readOnly: true });
		chatRequestMock
			.mockResolvedValueOnce(turnResponse({ toolCalls: [{ id: "c1", name: "read", args: { path: "a.md" } }] }))
			.mockResolvedValueOnce(turnResponse({ content: "ok", normalizedStopReason: "stop" }));
		const agent = makeAgent({ tools: { read: t } });
		await agent.generate({ prompt: "x" });
		expect(confirmMock).not.toHaveBeenCalled();
		expect(t.execute).toHaveBeenCalledOnce();
	});

	it("confirms a destructive tool when confirmToolCalls is undefined (old persisted settings default to 'destructive')", async () => {
		// main.ts shallow-merges settings, so an existing user's pre-confirmToolCalls
		// `ai` object leaves this undefined — it must NOT silently auto-run a writer.
		mockSettings.ai = { defaultSystemPrompt: "" } as typeof mockSettings.ai;
		confirmMock.mockResolvedValue("allow");
		const t = tool({ readOnly: false });
		chatRequestMock
			.mockResolvedValueOnce(turnResponse({ toolCalls: [{ id: "c1", name: "create_note", args: { path: "a.md" } }] }))
			.mockResolvedValueOnce(turnResponse({ content: "ok", normalizedStopReason: "stop" }));
		const agent = makeAgent({ tools: { create_note: t } });
		await agent.generate({ prompt: "x" });
		expect(confirmMock).toHaveBeenCalledOnce();
	});

	it("assigns result text to a variable (+ -quoted) when assignToVariable is set", async () => {
		const vars = new Map<string, unknown>();
		chatRequestMock.mockResolvedValueOnce(turnResponse({ content: "the answer", normalizedStopReason: "stop" }));
		const agent = makeAgent({}, vars);
		await agent.generate({ prompt: "q", assignToVariable: "summary" });
		expect(vars.get("summary")).toBe("the answer");
		expect(vars.get("summary-quoted")).toBe("> the answer");
	});

	it("trims assignToVariable so a padded name still resolves as {{VALUE:name}}", async () => {
		const vars = new Map<string, unknown>();
		chatRequestMock.mockResolvedValueOnce(turnResponse({ content: "trimmed", normalizedStopReason: "stop" }));
		const agent = makeAgent({}, vars);
		await agent.generate({ prompt: "q", assignToVariable: "  summary  " });
		expect(vars.get("summary")).toBe("trimmed");
		expect(vars.get("summary-quoted")).toBe("> trimmed");
	});

	it("rejects a reserved assignToVariable name", async () => {
		const agent = makeAgent();
		await expect(agent.generate({ prompt: "q", assignToVariable: "value" })).rejects.toThrow(/reserved/);
	});
});

describe("Agent.generate — structured output", () => {
	it("parses + validates the final turn into result.object", async () => {
		chatRequestMock.mockResolvedValueOnce(
			turnResponse({ content: '{"title":"Hi","tags":["a"]}', normalizedStopReason: "stop" }),
		);
		const agent = makeAgent();
		const res = await agent.generate({
			prompt: "extract",
			schema: { type: "object", properties: { title: { type: "string" }, tags: { type: "array", items: { type: "string" } } }, required: ["title"] },
		});
		expect(res.object).toEqual({ title: "Hi", tags: ["a"] });
	});

	it("repairs once when the first structured reply is invalid", async () => {
		chatRequestMock
			.mockResolvedValueOnce(turnResponse({ content: "not json at all", normalizedStopReason: "stop" }))
			.mockResolvedValueOnce(turnResponse({ content: '{"title":"Fixed"}', normalizedStopReason: "stop" }));
		const agent = makeAgent();
		const res = await agent.generate({
			prompt: "extract",
			schema: { type: "object", properties: { title: { type: "string" } }, required: ["title"] },
		});
		expect(res.object).toEqual({ title: "Fixed" });
		expect(chatRequestMock).toHaveBeenCalledTimes(2);
	});
});

describe("Agent construction validation", () => {
	it("rejects an invalid tool name", () => {
		expect(() => makeAgent({ tools: { "bad name!": tool() } })).toThrow(/Invalid tool name/);
	});
	it("rejects an unsupported schema keyword at registration", () => {
		const t = tool({ inputSchema: { type: "string", pattern: "^x" } });
		expect(() => makeAgent({ tools: { t } })).toThrow(/unsupported/i);
	});
});
