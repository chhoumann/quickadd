import { describe, expect, it, vi, beforeEach } from "vitest";

const runMock = vi.fn();

vi.mock("./MacroChoiceEngine", () => ({
	MacroChoiceEngine: class MacroChoiceEngineMock {
		private readonly choice: { name: string };
		constructor(
			_app: unknown,
			_plugin: unknown,
			choice: { name: string }
		) {
			this.choice = choice;
		}
		run() {
			return runMock(this.choice.name);
		}
	},
}));

// log.logError shows a Notice via GuiLogger; keep it quiet/inspectable in tests.
const logErrorMock = vi.fn();
vi.mock("../logger/logManager", () => ({
	log: {
		logError: (...args: unknown[]) => logErrorMock(...args),
		logWarning: vi.fn(),
		logMessage: vi.fn(),
	},
}));

import type { App } from "obsidian";
import { StartupMacroEngine } from "./StartupMacroEngine";
import type IChoice from "../types/choices/IChoice";
import type IMacroChoice from "../types/choices/IMacroChoice";
import type QuickAdd from "../main";
import type { IChoiceExecutor } from "../IChoiceExecutor";

function makeStartupMacro(name: string): IMacroChoice {
	return {
		name,
		id: `${name}-id`,
		type: "Macro",
		command: false,
		runOnStartup: true,
		macro: { name, id: `${name}-macro`, commands: [] },
	} as IMacroChoice;
}

describe("StartupMacroEngine error isolation", () => {
	beforeEach(() => {
		runMock.mockReset();
		logErrorMock.mockReset();
	});

	it("continues running later startup macros after one throws", async () => {
		runMock
			.mockResolvedValueOnce(undefined) // first macro succeeds
			.mockRejectedValueOnce(new Error("boom")) // second macro throws
			.mockResolvedValueOnce(undefined); // third macro should still run

		const choices: IChoice[] = [
			makeStartupMacro("first"),
			makeStartupMacro("second"),
			makeStartupMacro("third"),
		];

		const choiceExecutor: IChoiceExecutor = {
			execute: vi.fn(),
			variables: new Map<string, unknown>(),
		};

		const engine = new StartupMacroEngine(
			{} as App,
			{} as QuickAdd,
			choices,
			choiceExecutor
		);

		// Must not reject even though the second macro throws.
		await expect(engine.run()).resolves.toBeUndefined();

		expect(runMock).toHaveBeenCalledTimes(3);
		expect(runMock).toHaveBeenNthCalledWith(1, "first");
		expect(runMock).toHaveBeenNthCalledWith(2, "second");
		expect(runMock).toHaveBeenNthCalledWith(3, "third");
		// The failure is reported (Notice) naming the failing macro.
		expect(logErrorMock).toHaveBeenCalledTimes(1);
		const reported = String(logErrorMock.mock.calls[0][0]);
		expect(reported).toContain("second");
	});
});
