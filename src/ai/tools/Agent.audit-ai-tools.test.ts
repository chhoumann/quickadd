import { describe, it, expect, vi, beforeEach } from "vitest";
import type { CommonResponse } from "../OpenAIRequest";

// Mirror Agent.test.ts harness: mock the Obsidian-coupled deps the Agent reaches for.
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
		description: "writes a note",
		inputSchema: {
			type: "object" as const,
			properties: { path: { type: "string" as const } },
			required: ["path"],
		},
		execute: vi.fn(async () => "ok"),
		...extra,
	};
}

beforeEach(() => {
	chatRequestMock.mockReset();
	confirmMock.mockReset();
	confirmMock.mockResolvedValue("allow");
	mockSettings = {
		disableOnlineFeatures: false,
		// global 'never' so ONLY a per-tool needsApproval floor can trigger the modal.
		ai: { confirmToolCalls: "never", defaultSystemPrompt: "" },
	};
});

describe("ai-tools-tool-confirm-modal: approve-all does not bypass the per-tool needsApproval floor", () => {
	it("re-confirms a needsApproval:true tool on every call even after 'Approve all this run'", async () => {
		// First call: model invokes the writer; user clicks "Approve all this run".
		// Second call: same needsApproval:true writer — must STILL be confirmed.
		confirmMock.mockResolvedValueOnce("allow-all").mockResolvedValueOnce("allow");
		const t = tool({ needsApproval: true });
		chatRequestMock
			.mockResolvedValueOnce(turnResponse({ toolCalls: [{ id: "c1", name: "write", args: { path: "a.md" } }] }))
			.mockResolvedValueOnce(turnResponse({ toolCalls: [{ id: "c2", name: "write", args: { path: "b.md" } }] }))
			.mockResolvedValueOnce(turnResponse({ content: "done", normalizedStopReason: "stop" }));

		const agent = makeAgent({ tools: { write: t } });
		await agent.generate({ prompt: "write two notes" });

		// Before the fix the second call auto-ran (approveAllThisRun short-circuited
		// before the per-tool floor) → confirm called once. After: called twice.
		expect(confirmMock).toHaveBeenCalledTimes(2);
		expect(t.execute).toHaveBeenCalledTimes(2);
	});

	it("approve-all DOES auto-run a tool whose approval came only from the global setting", async () => {
		// 'destructive' global, non-readOnly tool with NO per-tool needsApproval.
		mockSettings.ai = { confirmToolCalls: "destructive", defaultSystemPrompt: "" };
		confirmMock.mockResolvedValueOnce("allow-all");
		const t = tool({ readOnly: false });
		chatRequestMock
			.mockResolvedValueOnce(turnResponse({ toolCalls: [{ id: "c1", name: "write", args: { path: "a.md" } }] }))
			.mockResolvedValueOnce(turnResponse({ toolCalls: [{ id: "c2", name: "write", args: { path: "b.md" } }] }))
			.mockResolvedValueOnce(turnResponse({ content: "done", normalizedStopReason: "stop" }));

		const agent = makeAgent({ tools: { write: t } });
		await agent.generate({ prompt: "write two notes" });

		// Only the first call prompts; allow-all then suppresses the global-only gate.
		expect(confirmMock).toHaveBeenCalledTimes(1);
		expect(t.execute).toHaveBeenCalledTimes(2);
	});
});
