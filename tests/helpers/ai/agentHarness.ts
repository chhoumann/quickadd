import { vi } from "vitest";
import type { CommonResponse } from "src/ai/OpenAIRequest";

const chatRequestMock = vi.fn<(...args: unknown[]) => Promise<CommonResponse>>();
vi.mock("src/ai/OpenAIRequest", () => ({
	chatRequest: (...args: unknown[]) => chatRequestMock(...args),
	anthropicMaxTokens: () => 8192,
}));

const confirmMock = vi.fn<() => Promise<string>>(async () => "allow");
vi.mock("src/gui/AIToolConfirmModal", () => ({
	default: { Prompt: () => confirmMock() },
}));

vi.mock("src/formatters/completeFormatter", () => ({
	CompleteFormatter: class {
		async formatFileContent(input: string) {
			return input; // identity — formatting is exercised elsewhere
		}
	},
}));

vi.mock("src/ai/aiHelpers", () => ({
	resolveModelInputOrThrow: (input: string | { name: string }) => ({
		model: {
			name: typeof input === "string" ? input : input.name,
			maxTokens: 128000,
		},
		provider: { name: "OpenAI", kind: "openai", endpoint: "https://x" },
	}),
}));

vi.mock("src/ai/providerSecrets", () => ({ resolveProviderApiKey: async () => "key" }));

vi.mock("src/ai/preventCursorChange", () => ({ preventCursorChange: () => () => {} }));

export const agentState: { settings: Record<string, unknown> } = { settings: {} };
vi.mock("src/settingsStore", () => ({
	settingsStore: { getState: () => agentState.settings },
}));

import { Agent } from "src/ai/tools/Agent";
import type { AgentConfig } from "src/ai/tools/aiToolTypes";

export function makeAgent(config: Partial<AgentConfig> = {}, vars = new Map<string, unknown>()) {
	const choiceExecutor = { variables: vars } as never;
	return new Agent(
		{} as never,
		{} as never,
		choiceExecutor,
		{ model: "gpt-4o", ...config } as AgentConfig,
	);
}

export function turnResponse(p: Partial<CommonResponse>): CommonResponse {
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

export function tool(extra: Record<string, unknown> = {}) {
	return {
		__qaTool: true as const,
		description: "create a note",
		inputSchema: { type: "object" as const, properties: { path: { type: "string" as const } }, required: ["path"] },
		execute: vi.fn(async () => "created"),
		...extra,
	};
}

export { chatRequestMock, confirmMock };
