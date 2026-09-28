import { createChoiceExecutor } from "../tests/helpers/createChoiceExecutor";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { App } from "obsidian";
import { QuickAddApi } from "./quickAddApi";
import type QuickAdd from "./main";
import type { IChoiceExecutor } from "./IChoiceExecutor";
import type IChoice from "./types/choices/IChoice";
import { MacroAbortError } from "./errors/MacroAbortError";
import { promptCancelled } from "./errors/UserCancelError";
import { collectUnhandledRejections } from "../tests/helpers/unhandledRejections";

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
			...createChoiceExecutor(),
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

	// Buttons in notes call executeChoice without a .catch. Pressing Escape in the
	// choice's prompt must not become an unhandled rejection (Obsidian's dev:errors).
	it("leaves no unhandled rejection when a floated call is cancelled by the user", async () => {
		(choiceExecutor.consumeAbortSignal as ReturnType<typeof vi.fn>).mockReturnValueOnce(
			promptCancelled(),
		);
		const api = QuickAddApi.GetApi(app, plugin, choiceExecutor);

		const unhandled = await collectUnhandledRejections(() => {
			void api.executeChoice("My Template");
		});

		expect(unhandled).toEqual([]);
	});

	it("still rejects with the user's cancellation for a script that awaits it", async () => {
		const cancel = promptCancelled();
		(choiceExecutor.consumeAbortSignal as ReturnType<typeof vi.fn>).mockReturnValueOnce(cancel);
		const api = QuickAddApi.GetApi(app, plugin, choiceExecutor);

		await expect(api.executeChoice("My Template")).rejects.toBe(cancel);
	});

	it("leaves a floated call's real failure unhandled so it is still reported", async () => {
		const failure = new Error("Template file not found");
		(choiceExecutor.execute as ReturnType<typeof vi.fn>).mockRejectedValueOnce(failure);
		const api = QuickAddApi.GetApi(app, plugin, choiceExecutor);

		const unhandled = await collectUnhandledRejections(() => {
			void api.executeChoice("My Template");
		});

		expect(unhandled).toEqual([failure]);
	});

	it("leaves a floated call's involuntary abort unhandled", async () => {
		const abort = new MacroAbortError("Target file missing");
		(choiceExecutor.consumeAbortSignal as ReturnType<typeof vi.fn>).mockReturnValueOnce(abort);
		const api = QuickAddApi.GetApi(app, plugin, choiceExecutor);

		const unhandled = await collectUnhandledRejections(() => {
			void api.executeChoice("My Template");
		});

		expect(unhandled).toEqual([abort]);
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
