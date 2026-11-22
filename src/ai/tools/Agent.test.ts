import { beforeEach, describe, expect, it, vi } from "vitest";

// --- Mock the Obsidian-coupled dependencies the Agent reaches for ---
import { chatRequestMock, confirmMock, agentState, makeAgent, turnResponse, tool } from "../../../tests/helpers/ai/agentHarness";
import { Agent } from "./Agent";

beforeEach(() => {
	chatRequestMock.mockReset();
	confirmMock.mockReset();
	confirmMock.mockResolvedValue("allow");
	agentState.settings = {
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
		agentState.settings.ai = { confirmToolCalls: "always", defaultSystemPrompt: "" };
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
		agentState.settings.ai = { confirmToolCalls: "always", defaultSystemPrompt: "" };
		const t = tool();
		chatRequestMock.mockResolvedValueOnce(
			turnResponse({ toolCalls: [{ id: "c1", name: "create_note", args: { path: "a.md" } }] }),
		);
		const agent = makeAgent({ tools: { create_note: t } });
		await expect(agent.generate({ prompt: "x" })).rejects.toThrow(/aborted/i);
	});

	it("does not confirm a read-only tool under the 'destructive' setting", async () => {
		agentState.settings.ai = { confirmToolCalls: "destructive", defaultSystemPrompt: "" };
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
		agentState.settings.ai = { defaultSystemPrompt: "" } as typeof agentState.settings.ai;
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

describe("Agent.generate — seed request", () => {
	// #1565 / #1568: the system prompt reaches the model verbatim; only the
	// prompt goes through the QuickAdd formatter.
	it("sends the system prompt unformatted and formats the prompt", async () => {
		chatRequestMock.mockResolvedValueOnce(turnResponse({ content: "ok" }));
		const system = "Today is {{DATE}} and the note is {{VALUE:title}}.";
		const format = async (input: string) => input.replace(/\{\{[^}]*\}\}/g, "RESOLVED");
		const agent = new Agent({} as never, { variables: new Map() } as never, { model: "gpt-4o", system }, format);

		await agent.generate({ prompt: "Summarise {{VALUE:body}}" });

		const request = chatRequestMock.mock.calls[0].find(
			(arg): arg is { messages: unknown[] } => typeof arg === "object" && arg !== null && "messages" in arg,
		);
		expect(request?.messages).toEqual([
			{ role: "system", content: system },
			{ role: "user", content: "Summarise RESOLVED" },
		]);
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

	// The repair is a best-effort second ask whose failure only leaves `object`
	// undefined, so it must not pop a failure notice for a run that succeeded.
	it("asks for the repair without reporting its failure", async () => {
		chatRequestMock
			.mockResolvedValueOnce(turnResponse({ content: "not json at all", normalizedStopReason: "stop" }))
			.mockRejectedValueOnce(new Error("provider down"));
		const agent = makeAgent();
		const res = await agent.generate({
			prompt: "extract",
			schema: { type: "object", properties: { title: { type: "string" } }, required: ["title"] },
		});
		expect(res.object).toBeUndefined();
		const repairCall = chatRequestMock.mock.calls[1];
		// chatRequest(apiKey, model, provider, request, afterRequest, reportFailure)
		expect(repairCall[5]).toBe(false);
	});

	it("does not spend a repair request on a refusal", async () => {
		chatRequestMock.mockResolvedValueOnce(
			turnResponse({ content: "I can't help with that.", stopReason: "refusal", normalizedStopReason: "other" }),
		);
		const agent = makeAgent();
		const res = await agent.generate({
			prompt: "extract",
			schema: { type: "object", properties: { title: { type: "string" } }, required: ["title"] },
		});
		expect(res.object).toBeUndefined();
		expect(res.text).toBe("I can't help with that.");
		expect(chatRequestMock).toHaveBeenCalledTimes(1);
	});

	it("never returns a refusal as the structured object, even when it parses", async () => {
		chatRequestMock.mockResolvedValueOnce(
			turnResponse({ content: '{"title":"refused"}', stopReason: "refusal", normalizedStopReason: "other" }),
		);
		const agent = makeAgent();
		const res = await agent.generate({
			prompt: "extract",
			schema: { type: "object", properties: { title: { type: "string" } }, required: ["title"] },
		});
		expect(res.object).toBeUndefined();
		expect(chatRequestMock).toHaveBeenCalledTimes(1);
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

describe("Agent.generate — approve all this run", () => {
	beforeEach(() => {
		// Global 'never', so ONLY a per-tool needsApproval floor can trigger the modal.
		agentState.settings.ai = { confirmToolCalls: "never", defaultSystemPrompt: "" };
	});

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
