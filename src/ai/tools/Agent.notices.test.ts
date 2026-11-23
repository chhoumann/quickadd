import { beforeEach, describe, expect, it, vi } from "vitest";

// A cancelled prompt inside an agent's tool closes the status notice instead
// of reporting the cancel as "AI request failed.", and a context overflow the
// loop ends on quietly is still reported.

const { notices, reportErrorSpy } = vi.hoisted(() => ({
	notices: [] as Array<{ messages: string[]; hidden: boolean }>,
	reportErrorSpy: vi.fn(),
}));
vi.mock("src/utils/errorUtils", async (importOriginal) => ({
	...(await importOriginal<object>()),
	reportError: reportErrorSpy,
}));
vi.mock("obsidian", async (importOriginal) => ({
	...(await importOriginal<object>()),
	Notice: class {
		private entry = { messages: [] as string[], hidden: false };
		constructor(message: string) {
			this.entry.messages.push(message);
			notices.push(this.entry);
		}
		setMessage(message: string) {
			this.entry.messages.push(message);
		}
		hide() {
			this.entry.hidden = true;
		}
	},
}));

import { agentState, chatRequestMock, confirmMock, makeAgent, tool, turnResponse } from "../../../tests/helpers/ai/agentHarness";
import { promptCancelled } from "src/errors/UserCancelError";

beforeEach(() => {
	chatRequestMock.mockReset();
	reportErrorSpy.mockReset();
	confirmMock.mockResolvedValue("allow");
	notices.length = 0;
	agentState.settings = {
		disableOnlineFeatures: false,
		ai: { confirmToolCalls: "never", defaultSystemPrompt: "", showAssistant: true },
	};
});

describe("Agent status notice", () => {
	it("closes without a failure message when a tool's prompt is cancelled", async () => {
		chatRequestMock.mockResolvedValueOnce(
			turnResponse({ toolCalls: [{ id: "c1", name: "ask", args: { path: "a.md" } }] }),
		);
		const ask = tool({ execute: vi.fn(async () => { throw promptCancelled(); }) });

		await expect(makeAgent({ tools: { ask } }).generate({ prompt: "hi" })).rejects.toThrow();

		expect(notices).toHaveLength(1);
		expect(notices[0].messages.some((m) => m.startsWith("AI request failed."))).toBe(false);
		expect(notices[0].hidden).toBe(true);
	});

	it("still reports a context overflow, which ends the run without throwing", async () => {
		const overflow = new Error("Error while making request to OpenAI: This model's maximum context length is 8192 tokens");
		chatRequestMock.mockRejectedValueOnce(overflow);

		const result = await makeAgent().generate({ prompt: "hi" });

		expect(result.finishReason).toBe("context-overflow");
		expect(reportErrorSpy).toHaveBeenCalledWith(overflow);
	});

	it("shows start, per-step and finish status for a multi-step run", async () => {
		chatRequestMock
			.mockResolvedValueOnce(
				turnResponse({ toolCalls: [{ id: "c1", name: "create_note", args: { path: "a.md" } }] }),
			)
			.mockResolvedValueOnce(turnResponse({ content: "done", normalizedStopReason: "stop" }));

		await makeAgent({ tools: { create_note: tool() } }).generate({ prompt: "make a note" });

		expect(notices).toHaveLength(1);
		const { messages } = notices[0];
		expect(messages[0]).toBe("Assistant is starting.");
		expect(messages.at(-1)).toMatch(/^Assistant is finished\./);
		// A step that ran a tool names the tool; the wrap-up step mentions a response.
		const steps = messages.filter((m) => m.startsWith("Assistant is thinking."));
		expect(steps.some((m) => m.includes("create_note"))).toBe(true);
		expect(steps.some((m) => /generating a response/i.test(m))).toBe(true);
	});

	it("shows no notice when assistant messages are off", async () => {
		agentState.settings.ai = { confirmToolCalls: "never", defaultSystemPrompt: "", showAssistant: false };
		chatRequestMock.mockResolvedValueOnce(turnResponse({ content: "done", normalizedStopReason: "stop" }));

		await makeAgent().generate({ prompt: "hi" });

		expect(notices).toHaveLength(0);
	});

	it("shows the failure when the run throws", async () => {
		chatRequestMock.mockRejectedValueOnce(new Error("provider exploded"));

		await expect(makeAgent().generate({ prompt: "boom" })).rejects.toThrow(/provider exploded/);

		expect(notices).toHaveLength(1);
		expect(notices[0].messages.at(-1)).toBe("AI request failed.\n\nprovider exploded");
	});
});
