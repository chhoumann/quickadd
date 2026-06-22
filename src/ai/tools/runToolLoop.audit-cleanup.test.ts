import { describe, it, expect, vi } from "vitest";
import {
	runToolLoop,
	type RunToolLoopDeps,
	type ToolEntry,
} from "./runToolLoop";
import type { NormalizedToolCall } from "./NormalizedTools";
import type { ParsedChatResult } from "./providerToolMapping";

// ai-tools-cost-exfil-caps: 'max-steps' must be reachable when the step budget
// forces the final turn — not derived from residual tool calls. The Agent strips
// tools on the final step (tools:undefined / toolChoice:'none'), so a real run can
// never present residual tool calls on the final turn. These tests pin the
// budget-forced classification independent of any residual-toolCalls signal.

function turn(p: Partial<ParsedChatResult>): ParsedChatResult {
	return {
		content: p.content ?? "",
		toolCalls: p.toolCalls ?? [],
		normalizedStopReason:
			p.normalizedStopReason ?? (p.toolCalls?.length ? "tool_calls" : "stop"),
		rawStopReason: p.rawStopReason ?? "",
		usage: p.usage ?? { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
		providerRaw: p.providerRaw,
	};
}

function call(name: string, args: Record<string, unknown> | null): NormalizedToolCall {
	return { id: `c-${name}`, name, args };
}

function toolEntry(name: string, execute: ToolEntry["execute"]): ToolEntry {
	return {
		definition: { name, description: name, parameters: { type: "object", properties: {} } },
		execute,
	};
}

function makeDeps(
	tools: Record<string, ToolEntry>,
	overrides: Partial<RunToolLoopDeps>,
): RunToolLoopDeps {
	return {
		request: {
			messages: [{ role: "user", content: "go" }],
			tools: Object.values(tools).map((t) => t.definition),
		},
		dispatch: vi.fn(async () => turn({ content: "done", normalizedStopReason: "stop" })),
		getTool: (name) => tools[name],
		confirm: async () => true,
		validateArgs: () => null,
		isAbortError: () => false,
		maxSteps: 8,
		...overrides,
	};
}

describe("runToolLoop — budget-forced max-steps (audit cleanup)", () => {
	it("reports 'max-steps' when the budget forces the final step, even with tools stripped (no residual tool calls)", async () => {
		// Mirror the Agent: the final step sends NO tools, so the model returns plain
		// text with a 'stop' reason. Without the budget-forced flag this would be
		// reported as 'stop' (the old residual-toolCalls path is unreachable here).
		const deps = makeDeps(
			{ t: toolEntry("t", async () => "x") },
			{
				maxSteps: 2,
				dispatch: vi.fn(async (_req, ctx) =>
					ctx.isFinalStep
						? turn({ content: "forced wrap-up", normalizedStopReason: "stop" })
						: turn({ toolCalls: [call("t", {})] }),
				),
			},
		);
		const res = await runToolLoop(deps);
		expect(res.finishReason).toBe("max-steps");
		expect(res.text).toBe("forced wrap-up");
	});

	it("reports 'stop' (not 'max-steps') when a stopWhen condition forced the final step", async () => {
		// stopWhen trips after the first tool step → forceFinal. Even if that final
		// step coincides with the budget, a graceful stop must win over max-steps.
		const deps = makeDeps(
			{ t: toolEntry("t", async () => "x") },
			{
				maxSteps: 2,
				shouldStop: ({ steps }) => steps.some((s) => s.toolResults.length > 0),
				dispatch: vi.fn(async (_req, ctx) =>
					ctx.isFinalStep
						? turn({ content: "stopped early", normalizedStopReason: "stop" })
						: turn({ toolCalls: [call("t", {})] }),
				),
			},
		);
		const res = await runToolLoop(deps);
		expect(res.finishReason).toBe("stop");
		expect(res.text).toBe("stopped early");
	});

	it("reports 'stop' (not 'max-steps') when the transcript-bytes ceiling forced the final step", async () => {
		const big = "x".repeat(2000);
		const deps = makeDeps(
			{ t: toolEntry("t", async () => big) },
			{
				maxSteps: 8,
				maxTranscriptBytes: 100,
				dispatch: vi.fn(async (_req, ctx) =>
					ctx.isFinalStep
						? turn({ content: "wrapped up", normalizedStopReason: "stop" })
						: turn({ toolCalls: [call("t", {})] }),
				),
			},
		);
		const res = await runToolLoop(deps);
		expect(res.finishReason).toBe("stop");
	});

	it("reports 'stop' for a single-turn (maxSteps 1) run where the model just answers", async () => {
		// A degenerate budget-forced-on-step-0 run is a one-shot answer, not an
		// agentic budget exhaustion — must stay 'stop'.
		const deps = makeDeps(
			{ t: toolEntry("t", async () => "x") },
			{
				maxSteps: 1,
				dispatch: vi.fn(async () => turn({ content: "single answer", normalizedStopReason: "stop" })),
			},
		);
		const res = await runToolLoop(deps);
		expect(res.finishReason).toBe("stop");
		expect(res.text).toBe("single answer");
	});

	it("'length' still takes precedence over a budget-forced final step", async () => {
		const deps = makeDeps(
			{ t: toolEntry("t", async () => "x") },
			{
				maxSteps: 2,
				dispatch: vi.fn(async (_req, ctx) =>
					ctx.isFinalStep
						? turn({ content: "cut", normalizedStopReason: "length" })
						: turn({ toolCalls: [call("t", {})] }),
				),
			},
		);
		const res = await runToolLoop(deps);
		expect(res.finishReason).toBe("length");
	});
});
