import { beforeEach, describe, expect, it, vi } from "vitest";
import type { App } from "obsidian";
import { MacroAbortError } from "../errors/MacroAbortError";
import type { IChoiceExecutor } from "../IChoiceExecutor";
import type IChoice from "../types/choices/IChoice";
import type IMacroChoice from "../types/choices/IMacroChoice";
import { StartupMacroEngine } from "./StartupMacroEngine";
import { createChoiceExecutionResult } from "./runtime";

const {
	mockMacroRun,
	mockMacroConstructor,
	mockLogWarning,
} = vi.hoisted(() => ({
	mockMacroRun: vi.fn(),
	mockMacroConstructor: vi.fn(),
	mockLogWarning: vi.fn(),
}));

vi.mock("./MacroChoiceEngine", () => ({
	MacroChoiceEngine: class MacroChoiceEngineMock {
		constructor(...args: unknown[]) {
			mockMacroConstructor(args);
		}

		async run() {
			return await mockMacroRun();
		}
	},
}));

vi.mock("../logger/logManager", () => ({
	log: {
		logWarning: mockLogWarning,
	},
}));

function createStartupMacroChoice(id: string, name: string): IMacroChoice {
	return {
		id,
		name,
		type: "Macro",
		command: false,
		runOnStartup: true,
		macro: {
			id: `${id}-macro`,
			name: `${name} macro`,
			commands: [],
		},
	};
}

describe("StartupMacroEngine", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("stops running remaining startup macros after an aborted macro", async () => {
		const firstChoice = createStartupMacroChoice("first", "First startup macro");
		const secondChoice = createStartupMacroChoice("second", "Second startup macro");
		const abort = new MacroAbortError("Input cancelled by user");
		const choiceExecutor: IChoiceExecutor = {
			variables: new Map<string, unknown>(),
			execute: vi.fn(),
			consumeAbortSignal: vi
				.fn<() => MacroAbortError | null>()
				.mockReturnValueOnce(abort)
				.mockReturnValue(null),
		};

		mockMacroRun
			.mockResolvedValueOnce(
				createChoiceExecutionResult({
					status: "aborted",
					choiceId: firstChoice.id,
					error: abort,
				}),
			)
			.mockResolvedValueOnce(
				createChoiceExecutionResult({
					status: "success",
					choiceId: secondChoice.id,
				}),
			);

		const engine = new StartupMacroEngine(
			{} as App,
			{} as any,
			[firstChoice as IChoice, secondChoice as IChoice],
			choiceExecutor,
		);

		await engine.run();

		expect(mockMacroRun).toHaveBeenCalledTimes(1);
		expect(choiceExecutor.consumeAbortSignal).toHaveBeenCalledTimes(1);
		expect(mockLogWarning).toHaveBeenCalledWith(
			expect.stringContaining(firstChoice.name),
		);
	});
});
