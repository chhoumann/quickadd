import { describe, it, expect, vi, beforeEach } from "vitest";

// Mirror Agent.test.ts harness: mock the Obsidian-coupled deps the Agent reaches for.
import { chatRequestMock, confirmMock, agentState, makeAgent, turnResponse, tool } from "../../../tests/helpers/ai/agentHarness";

beforeEach(() => {
	chatRequestMock.mockReset();
	confirmMock.mockReset();
	confirmMock.mockResolvedValue("allow");
	agentState.settings = {
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
		const t = tool({ needsApproval: true, description: "writes a note", execute: vi.fn(async () => "ok") });
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
		agentState.settings.ai = { confirmToolCalls: "destructive", defaultSystemPrompt: "" };
		confirmMock.mockResolvedValueOnce("allow-all");
		const t = tool({ readOnly: false, description: "writes a note", execute: vi.fn(async () => "ok") });
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
