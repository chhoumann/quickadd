import { describe, it, expect, vi } from "vitest";
import {
	runToolLoop,
	stringifyToolResult,
	type RunToolLoopDeps,
	type ToolEntry,
} from "./runToolLoop";
import type { NormalizedToolCall } from "./NormalizedTools";
import type { ParsedChatResult } from "./providerToolMapping";

class FakeAbort extends Error {}

function turn(p: Partial<ParsedChatResult>): ParsedChatResult {
	return {
		content: p.content ?? "",
		toolCalls: p.toolCalls ?? [],
		normalizedStopReason: p.normalizedStopReason ?? (p.toolCalls?.length ? "tool_calls" : "stop"),
		rawStopReason: p.rawStopReason ?? "",
		usage: p.usage ?? { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
		providerRaw: p.providerRaw,
	};
}

function call(name: string, args: Record<string, unknown> | null, extra: Partial<NormalizedToolCall> = {}): NormalizedToolCall {
	return { id: extra.id ?? `c-${name}`, name, args, ...extra };
}

function makeDeps(
	turns: ParsedChatResult[],
	tools: Record<string, ToolEntry>,
	overrides: Partial<RunToolLoopDeps> = {},
): RunToolLoopDeps {
	const queue = [...turns];
	return {
		request: { messages: [{ role: "user", content: "go" }], tools: Object.values(tools).map((t) => t.definition) },
		dispatch: vi.fn(async (_req, ctx) => {
			// If a final step is forced, return a plain text turn unless the test queued one.
			const next = queue.shift();
			if (next) return next;
			return turn({ content: ctx.isFinalStep ? "final text" : "done", normalizedStopReason: "stop" });
		}),
		getTool: (name) => tools[name],
		confirm: async () => true,
		validateArgs: () => null,
		isAbortError: (e) => e instanceof FakeAbort,
		maxSteps: 8,
		...overrides,
	};
}

function toolEntry(name: string, execute: ToolEntry["execute"], readOnly = false): ToolEntry {
	return {
		definition: { name, description: name, parameters: { type: "object", properties: {} } },
		execute,
		readOnly,
	};
}

describe("runToolLoop", () => {
	it("runs a single tool call then returns the final text", async () => {
		const exec = vi.fn(async () => "tool-ran");
		const deps = makeDeps(
			[turn({ toolCalls: [call("t", { x: 1 })] }), turn({ content: "all done", normalizedStopReason: "stop" })],
			{ t: toolEntry("t", exec) },
		);
		const res = await runToolLoop(deps);
		expect(exec).toHaveBeenCalledOnce();
		expect(res.text).toBe("all done");
		expect(res.finishReason).toBe("stop");
		// transcript: user, assistant(tool_calls), tool(results), [final text has no append]
		const toolTurn = res.messages.find((m) => m.role === "tool");
		expect(toolTurn).toBeDefined();
		expect(res.steps.length).toBe(2);
	});

	it("executes parallel tool calls from one turn and returns all results together", async () => {
		const exec = vi.fn(async (args: Record<string, unknown>) => `r:${args.city}`);
		const deps = makeDeps(
			[
				turn({ toolCalls: [call("w", { city: "Paris" }, { id: "a" }), call("w", { city: "London" }, { id: "b" })] }),
				turn({ content: "compared", normalizedStopReason: "stop" }),
			],
			{ w: toolEntry("w", exec) },
		);
		const res = await runToolLoop(deps);
		expect(exec).toHaveBeenCalledTimes(2);
		const toolTurn = res.messages.find((m) => m.role === "tool");
		expect(toolTurn && "results" in toolTurn && toolTurn.results.map((r) => r.toolCallId)).toEqual(["a", "b"]);
	});

	it("propagates a MacroAbort-style error from a handler (kills the run)", async () => {
		const deps = makeDeps(
			[turn({ toolCalls: [call("t", {})] })],
			{ t: toolEntry("t", async () => { throw new FakeAbort("aborted"); }) },
		);
		await expect(runToolLoop(deps)).rejects.toBeInstanceOf(FakeAbort);
	});

	it("turns a non-abort handler throw into an isError result", async () => {
		const deps = makeDeps(
			[turn({ toolCalls: [call("t", {})] }), turn({ content: "recovered" })],
			{ t: toolEntry("t", async () => { throw new Error("boom"); }) },
		);
		const res = await runToolLoop(deps);
		const tr = res.steps[0].toolResults[0];
		expect(tr.isError).toBe(true);
		expect(tr.content).toMatch(/tool execution failed: boom/);
		expect(res.text).toBe("recovered");
	});

	it("returns isError for an unknown tool, a parseError call, a schema-invalid call, and a denied call", async () => {
		const deps = makeDeps(
			[
				turn({ toolCalls: [
					call("missing", {}),
					call("t", null, { id: "pe", parseError: true }),
					call("t", { bad: true }, { id: "iv" }),
					call("t", {}, { id: "dn" }),
				] }),
				turn({ content: "ok" }),
			],
			{ t: toolEntry("t", async () => "ran") },
			{
				validateArgs: (_tool, args) => ("bad" in args ? "bad field" : null),
				confirm: async (c) => c.id !== "dn",
			},
		);
		const res = await runToolLoop(deps);
		const byId = Object.fromEntries(res.steps[0].toolResults.map((r) => [r.toolCallId, r]));
		expect(byId["c-missing"].content).toMatch(/unknown tool/);
		expect(byId["pe"].content).toMatch(/could not parse/);
		expect(byId["iv"].content).toMatch(/invalid arguments: bad field/);
		expect(byId["dn"].content).toMatch(/denied by user/);
		expect(res.steps[0].toolResults.every((r) => r.isError)).toBe(true);
	});

	it("forces a final no-tool turn at the step budget and reports max-steps when the model still wants tools", async () => {
		// A 'never stops' model: every dispatch returns a tool call, even on the final step.
		const deps = makeDeps([], { t: toolEntry("t", async () => "x") }, {
			maxSteps: 2,
			dispatch: vi.fn(async (_req, ctx) => turn({
				content: ctx.isFinalStep ? "forced text" : "",
				toolCalls: ctx.isFinalStep ? [call("t", {})] : [call("t", {})],
			})),
		});
		const res = await runToolLoop(deps);
		expect(res.finishReason).toBe("max-steps");
		// dispatch received isFinalStep on the last call
		const calls = (deps.dispatch as ReturnType<typeof vi.fn>).mock.calls;
		expect(calls[calls.length - 1][1]).toEqual({ isFinalStep: true });
	});

	it("trips the transcript-bytes ceiling (cumulative re-sent transcript) and forces an early final turn", async () => {
		const big = "x".repeat(2000);
		// A model that ALWAYS wants tools — without the byte ceiling it would run to
		// maxSteps (8). The ceiling must force a final text turn far earlier because the
		// 2 KB tool result is re-sent every turn (>> the 100-byte cap).
		const deps = makeDeps(
			[],
			{ t: toolEntry("t", async () => big) },
			{
				maxTranscriptBytes: 100,
				maxSteps: 8,
				dispatch: vi.fn(async (_req, ctx) =>
					turn({
						content: ctx.isFinalStep ? "wrapped up" : "",
						toolCalls: ctx.isFinalStep ? [] : [call("t", {})],
						normalizedStopReason: ctx.isFinalStep ? "stop" : "tool_calls",
					}),
				),
			},
		);
		const res = await runToolLoop(deps);
		expect(res.text).toBe("wrapped up");
		expect(res.finishReason).toBe("stop");
		// Seed is tiny (<100 B), so step 0's small upload does not trip; step 1 re-sends
		// the first 2 KB result → trips → step 2 is the forced final. Far below maxSteps.
		expect(res.steps.length).toBe(3);
	});

	it("returns context-overflow when a dispatch errors with a context-window overflow", async () => {
		let n = 0;
		const deps = makeDeps([], { t: toolEntry("t", async () => "x") }, {
			maxSteps: 5,
			dispatch: vi.fn(async () => {
				n++;
				if (n === 1) return turn({ toolCalls: [call("t", {})] });
				throw new Error("input length and max_tokens exceed context limit");
			}),
			isContextOverflow: (e) => e instanceof Error && e.message.includes("context limit"),
		});
		const res = await runToolLoop(deps);
		expect(res.finishReason).toBe("context-overflow");
	});

	it("honors shouldStop (stopWhen) by forcing an early final turn", async () => {
		const deps = makeDeps(
			[turn({ toolCalls: [call("t", {})] }), turn({ content: "stopped early", normalizedStopReason: "stop" })],
			{ t: toolEntry("t", async () => "x") },
			{ maxSteps: 8, shouldStop: ({ steps }) => steps.some((s) => s.toolResults.length > 0) },
		);
		const res = await runToolLoop(deps);
		expect(res.text).toBe("stopped early");
		expect(res.steps.length).toBe(2);
	});

	it("stops gracefully if online features flip off mid-loop", async () => {
		let disabled = false;
		const deps = makeDeps(
			[turn({ toolCalls: [call("t", {})] }), turn({ content: "never reached" })],
			{ t: toolEntry("t", async () => { disabled = true; return "x"; }) },
			{ isOnlineDisabled: () => disabled },
		);
		const res = await runToolLoop(deps);
		expect(res.finishReason).toBe("aborted");
	});
});

describe("stringifyToolResult", () => {
	it("passes strings through, JSON-stringifies objects, and marks null/undefined as ok", () => {
		expect(stringifyToolResult("hi", 1000)).toEqual({ content: "hi", isError: false });
		expect(stringifyToolResult({ a: 1 }, 1000)).toEqual({ content: '{"a":1}', isError: false });
		expect(stringifyToolResult(null, 1000)).toEqual({ content: '{"ok":true}', isError: false });
		expect(stringifyToolResult(undefined, 1000)).toEqual({ content: '{"ok":true}', isError: false });
	});

	it("truncates oversized results with a marker", () => {
		const r = stringifyToolResult("y".repeat(5000), 100);
		expect(r.content.endsWith("…[truncated]")).toBe(true);
		expect(r.content.length).toBeLessThan(5000);
	});

	it("returns isError for a non-serializable value", () => {
		const circular: Record<string, unknown> = {};
		circular.self = circular;
		expect(stringifyToolResult(circular, 1000).isError).toBe(true);
	});
});
