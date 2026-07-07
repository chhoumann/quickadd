import { describe, it, expect, vi, beforeEach } from "vitest";
import type { CommonResponse } from "../OpenAIRequest";

// ai-tools-agent-generate-text: a multi-step agent run must surface start/step/finish
// status Notices through makeNoticeHandler — mirroring the legacy ai.prompt path —
// and ONLY when the "Show assistant messages" (ai.showAssistant) setting is on.

// --- Mirror Agent.test.ts harness: mock the Obsidian-coupled deps. ---
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
			return input;
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

// Capture every status emitted through the notice handler. Gated path: when
// makeNoticeHandler is created with showMessages=false it returns a no-op handler,
// so we record the showMessages flag the Agent passed too.
const noticeCalls: Array<{ status: string; msg: string }> = [];
const makeNoticeHandlerMock = vi.fn((showMessages: boolean) => {
	if (!showMessages) {
		return { setMessage: () => {}, hide: () => {} };
	}
	return {
		setMessage: (status: string, msg: string) => noticeCalls.push({ status, msg }),
		hide: () => {},
	};
});
vi.mock("../makeNoticeHandler", () => ({
	makeNoticeHandler: (showMessages: boolean) => makeNoticeHandlerMock(showMessages),
}));

let mockSettings: Record<string, unknown>;
vi.mock("../../settingsStore", () => ({
	settingsStore: { getState: () => mockSettings },
}));

import { Agent } from "./Agent";
import type { AgentConfig } from "./aiToolTypes";

function makeAgent(config: Partial<AgentConfig> = {}, vars = new Map<string, unknown>()) {
	const choiceExecutor = { variables: vars } as never;
	return new Agent({} as never, {} as never, choiceExecutor, {
		model: "gpt-4o",
		...config,
	} as AgentConfig);
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
		inputSchema: {
			type: "object" as const,
			properties: { path: { type: "string" as const } },
			required: ["path"],
		},
		execute: vi.fn(async () => "created"),
		...extra,
	};
}

beforeEach(() => {
	chatRequestMock.mockReset();
	confirmMock.mockReset();
	confirmMock.mockResolvedValue("allow");
	makeNoticeHandlerMock.mockClear();
	noticeCalls.length = 0;
	mockSettings = {
		disableOnlineFeatures: false,
		ai: { confirmToolCalls: "never", defaultSystemPrompt: "", showAssistant: true },
	};
});

describe("ai-tools-agent-generate-text: status notices follow ai.showAssistant", () => {
	it("emits start, per-step, and finish status notices for a multi-step run when showAssistant is on", async () => {
		const t = tool();
		chatRequestMock
			.mockResolvedValueOnce(
				turnResponse({ toolCalls: [{ id: "c1", name: "create_note", args: { path: "a.md" } }] }),
			)
			.mockResolvedValueOnce(turnResponse({ content: "done", normalizedStopReason: "stop" }));

		const agent = makeAgent({ tools: { create_note: t } });
		await agent.generate({ prompt: "make a note" });

		expect(makeNoticeHandlerMock).toHaveBeenCalledWith(true);
		const statuses = noticeCalls.map((c) => c.status);
		// start, one per step (tool step + final text step), finish.
		expect(statuses[0]).toBe("starting");
		expect(statuses[statuses.length - 1]).toBe("finished");
		// At least one mid-run "thinking" step notice was emitted.
		expect(statuses).toContain("thinking");
		// A step that ran a tool names the tool; the wrap-up step mentions a response.
		const stepMessages = noticeCalls.filter((c) => c.status === "thinking").map((c) => c.msg);
		expect(stepMessages.some((m) => m.includes("create_note"))).toBe(true);
		expect(stepMessages.some((m) => /generating a response/i.test(m))).toBe(true);
	});

	it("emits NO notices when showAssistant is off (no-op handler)", async () => {
		mockSettings.ai = { confirmToolCalls: "never", defaultSystemPrompt: "", showAssistant: false };
		chatRequestMock.mockResolvedValueOnce(turnResponse({ content: "done", normalizedStopReason: "stop" }));

		const agent = makeAgent();
		await agent.generate({ prompt: "hi" });

		expect(makeNoticeHandlerMock).toHaveBeenCalledWith(false);
		expect(noticeCalls).toHaveLength(0);
	});

	it("emits a 'dead' failure status when the run throws", async () => {
		chatRequestMock.mockRejectedValueOnce(new Error("provider exploded"));
		const agent = makeAgent();
		await expect(agent.generate({ prompt: "boom" })).rejects.toThrow(/provider exploded/);

		const statuses = noticeCalls.map((c) => c.status);
		expect(statuses[0]).toBe("starting");
		expect(statuses).toContain("dead");
		const dead = noticeCalls.find((c) => c.status === "dead");
		expect(dead?.msg).toMatch(/provider exploded/);
	});
});
