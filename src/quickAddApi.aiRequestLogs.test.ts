import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { App } from "obsidian";
import {
	beginAIRequestLogEntry,
	clearAIRequestLogEntries,
	finishAIRequestLogEntry,
} from "./ai/AIAssistant";
import type { IChoiceExecutor } from "./IChoiceExecutor";
import type QuickAdd from "./main";
import { QuickAddApi } from "./quickAddApi";

vi.mock("./quickAddSettingsTab", () => ({
	DEFAULT_SETTINGS: {},
	QuickAddSettingsTab: class {},
}));

vi.mock("./formatters/completeFormatter", () => ({
	CompleteFormatter: class CompleteFormatterMock {},
}));

vi.mock("obsidian-dataview", () => ({
	getAPI: vi.fn(),
}));

describe("QuickAddApi.ai request logs", () => {
	let api: ReturnType<typeof QuickAddApi.GetApi>;

	beforeEach(() => {
		clearAIRequestLogEntries();

		const choiceExecutor = {
			execute: vi.fn().mockResolvedValue(undefined),
			variables: new Map<string, unknown>(),
		} as unknown as IChoiceExecutor;

		api = QuickAddApi.GetApi(
			{} as App,
			{} as QuickAdd,
			choiceExecutor
		);
	});

	afterEach(() => {
		clearAIRequestLogEntries();
	});

	it("returns last log and resolves logs by id", () => {
		const id = beginAIRequestLogEntry({
			provider: "OpenAI",
			endpoint: "https://api.openai.com/v1",
			model: "gpt-5-nano",
			systemPrompt: "system",
			prompt: "prompt",
			modelOptions: {},
		});

		finishAIRequestLogEntry(id, {
			status: "success",
			durationMs: 1234,
			usage: {
				promptTokens: 10,
				completionTokens: 5,
				totalTokens: 15,
			},
		});

		const logs = api.ai.getRequestLogs(10);
		const last = api.ai.getLastRequestLog();
		const byId = api.ai.getRequestLogById(id);

		expect(logs).toHaveLength(1);
		expect(logs[0].id).toBe(id);
		expect(last?.id).toBe(id);
		expect(byId?.id).toBe(id);
		expect(byId?.status).toBe("success");
		expect(byId?.usage?.totalTokens).toBe(15);
	});

	it("clears request logs via API", () => {
		beginAIRequestLogEntry({
			provider: "OpenAI",
			endpoint: "https://api.openai.com/v1",
			model: "gpt-5-nano",
			systemPrompt: "system",
			prompt: "prompt",
			modelOptions: {},
		});

		expect(api.ai.getRequestLogs(10)).toHaveLength(1);

		api.ai.clearRequestLogs();

		expect(api.ai.getRequestLogs(10)).toHaveLength(0);
		expect(api.ai.getLastRequestLog()).toBeNull();
	});

	it("retains only the latest 25 completed request logs", () => {
		const ids: string[] = [];

		for (let i = 0; i < 30; i += 1) {
			const id =
				beginAIRequestLogEntry({
					provider: "OpenAI",
					endpoint: "https://api.openai.com/v1",
					model: `model-${i}`,
					systemPrompt: "system",
					prompt: `prompt-${i}`,
					modelOptions: {},
				});
			ids.push(id);
			finishAIRequestLogEntry(id, {
				status: "success",
				durationMs: 1,
				usage: {
					promptTokens: 1,
					completionTokens: 1,
					totalTokens: 2,
				},
			});
		}

		const oldestId = ids[0];
		const newestId = ids[ids.length - 1];

		expect(api.ai.getRequestLogs(50)).toHaveLength(25);
		expect(api.ai.getRequestLogById(oldestId)).toBeNull();
		expect(api.ai.getRequestLogById(newestId)?.id).toBe(newestId);
	});

	it("returns empty list when limit is 0", () => {
		beginAIRequestLogEntry({
			provider: "OpenAI",
			endpoint: "https://api.openai.com/v1",
			model: "gpt-5-nano",
			systemPrompt: "system",
			prompt: "prompt",
			modelOptions: {},
		});

		expect(api.ai.getRequestLogs(0)).toHaveLength(0);
	});

	it("does not evict pending entries before they finish", () => {
		const ids: string[] = [];

		for (let i = 0; i < 30; i += 1) {
			ids.push(
				beginAIRequestLogEntry({
					provider: "OpenAI",
					endpoint: "https://api.openai.com/v1",
					model: `model-${i}`,
					systemPrompt: "system",
					prompt: `prompt-${i}`,
					modelOptions: {},
				}),
			);
		}

		expect(api.ai.getRequestLogs(100)).toHaveLength(30);
		expect(api.ai.getRequestLogById(ids[0])?.status).toBe("pending");

		for (const id of ids) {
			finishAIRequestLogEntry(id, {
				status: "success",
				durationMs: 1,
				usage: {
					promptTokens: 1,
					completionTokens: 1,
					totalTokens: 2,
				},
			});
		}

		expect(api.ai.getRequestLogs(100)).toHaveLength(25);
		expect(api.ai.getRequestLogById(ids[0])).toBeNull();
		expect(api.ai.getRequestLogById(ids[ids.length - 1])?.id).toBe(
			ids[ids.length - 1],
		);
	});
});
