import { beforeEach, describe, expect, it, vi } from "vitest";
import type { App } from "obsidian";
import { QuickAddApi } from "./quickAddApi";
import type QuickAdd from "./main";
import type { IChoiceExecutor } from "./IChoiceExecutor";
import type IChoice from "./types/choices/IChoice";
import { MacroAbortError } from "./errors/MacroAbortError";

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

describe("QuickAddApi.executeChoice", () => {
	const app = {} as App;
	let plugin: QuickAdd & { getChoiceByName: ReturnType<typeof vi.fn>; };
	let choiceExecutor: IChoiceExecutor;
	let variables: Map<string, unknown>;
	const choice: IChoice = {
		id: "template",
		name: "My Template",
		type: "Template",
		command: false,
	};

	beforeEach(() => {
		variables = new Map<string, unknown>();
		choiceExecutor = {
			execute: vi.fn().mockResolvedValue(undefined),
			variables,
			consumeAbortSignal: vi.fn().mockReturnValue(null),
		};
		plugin = {
			getChoiceByName: vi.fn().mockReturnValue(choice),
		} as unknown as QuickAdd & {
			getChoiceByName: ReturnType<typeof vi.fn>;
		};
	});

	it("propagates aborts from executed choices", async () => {
		const abortError = new MacroAbortError("Input cancelled by user");
		(choiceExecutor.consumeAbortSignal as ReturnType<typeof vi.fn>).mockReturnValueOnce(abortError);
		const api = QuickAddApi.GetApi(app, plugin, choiceExecutor);

		variables.set("foo", "bar");
		await expect(api.executeChoice("My Template"))
			.rejects.toBe(abortError);
		expect(choiceExecutor.consumeAbortSignal).toHaveBeenCalledTimes(1);
		expect(variables.size).toBe(0);
	});

	it("clears variables and resolves when no abort is signalled", async () => {
		const api = QuickAddApi.GetApi(app, plugin, choiceExecutor);
		await expect(
			api.executeChoice("My Template", { project: "QA" }),
		).resolves.toBeUndefined();
		expect(choiceExecutor.consumeAbortSignal).toHaveBeenCalledTimes(1);
		expect(variables.size).toBe(0);
	});
});
