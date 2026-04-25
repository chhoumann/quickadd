import { beforeEach, describe, expect, it, vi } from "vitest";
import type IChoice from "./types/choices/IChoice";
import type IMacroChoice from "./types/choices/IMacroChoice";
import type { IMacro } from "./types/macros/IMacro";
import { CommandType } from "./types/macros/CommandType";
import { createChoiceExecutionResult } from "./engine/runtime";

const {
	mockGetOpenFileOriginLeaf,
	mockTemplateConstructor,
	mockMacroConstructor,
	mockChoiceSuggesterOpen,
} = vi.hoisted(() => ({
	mockGetOpenFileOriginLeaf: vi.fn(),
	mockTemplateConstructor: vi.fn(),
	mockMacroConstructor: vi.fn(),
	mockChoiceSuggesterOpen: vi.fn(),
}));

vi.mock("./utilityObsidian", () => ({
	getOpenFileOriginLeaf: mockGetOpenFileOriginLeaf,
}));

vi.mock("./preflight/runOnePagePreflight", () => ({
	runOnePagePreflight: vi.fn(),
}));

vi.mock("./settingsStore", () => ({
	settingsStore: {
		getState: () => ({ onePageInputEnabled: false }),
	},
}));

vi.mock("./gui/suggesters/choiceSuggester", () => ({
	__esModule: true,
	default: {
		Open: mockChoiceSuggesterOpen,
	},
}));

vi.mock("./engine/TemplateChoiceEngine", () => ({
	TemplateChoiceEngine: class TemplateChoiceEngineMock {
		constructor(...args: any[]) {
			mockTemplateConstructor({
				args,
				context: args[3]?.getExecutionContext?.(),
				originLeaf: args[4],
			});
		}

		async run() {
			return undefined;
		}
	},
}));

vi.mock("./engine/CaptureChoiceEngine", () => ({
	CaptureChoiceEngine: class CaptureChoiceEngineMock {
		async run() {
			return undefined;
		}
	},
}));

vi.mock("./engine/MacroChoiceEngine", () => ({
	MacroChoiceEngine: class MacroChoiceEngineMock {
		params = { variables: {} };

		constructor(
			_app: unknown,
			_plugin: unknown,
			private readonly choice: IMacroChoice,
			private readonly choiceExecutor: {
				execute: (choice: IChoice) => Promise<unknown>;
				getExecutionContext?: () => unknown;
			},
			_variables: Map<string, unknown>,
			_preloaded?: unknown,
			_promptLabel?: unknown,
			private readonly originLeaf?: unknown,
		) {
			mockMacroConstructor({
				choice,
				context: this.choiceExecutor.getExecutionContext?.(),
				originLeaf,
			});
		}

		async run() {
			const firstCommand = this.choice.macro?.commands?.[0] as
				| { type: string; choice?: IChoice }
				| undefined;
			const nestedChoice = firstCommand?.type === "NestedChoice"
				? firstCommand.choice
				: undefined;
			if (nestedChoice) {
				await this.choiceExecutor.execute(nestedChoice);
			}
			return createChoiceExecutionResult({
				status: "success",
				choiceId: this.choice.id,
			});
		}
	},
}));

import { ChoiceExecutor } from "./choiceExecutor";

describe("ChoiceExecutor runtime context", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("creates one root context and reuses its origin leaf for nested choices", async () => {
		const originLeaf = { id: "origin-leaf" };
		mockGetOpenFileOriginLeaf.mockReturnValue(originLeaf);
		const app = { plugins: { plugins: {} } } as any;
		const plugin = {} as any;
		const nestedChoice: IChoice = {
			id: "nested-template",
			name: "Nested Template",
			type: "Template",
			command: false,
		};
		const macroChoice: IMacroChoice = {
			id: "macro-choice",
			name: "Macro",
			type: "Macro",
			command: false,
			runOnStartup: false,
			macro: {
				id: "macro",
				name: "Macro",
				commands: [
					{
						id: "nested-command",
						name: "Nested",
						type: CommandType.NestedChoice,
						choice: nestedChoice,
					} as any,
				],
			} as IMacro,
		};

		const executor = new ChoiceExecutor(app, plugin);
		const result = await executor.execute(macroChoice);

		expect(result.status).toBe("success");
		expect(mockGetOpenFileOriginLeaf).toHaveBeenCalledTimes(1);
		const macroCall = mockMacroConstructor.mock.calls[0]?.[0];
		expect(macroCall.originLeaf).toBe(originLeaf);
		expect(macroCall.context?.originLeaf).toBe(originLeaf);
		const templateCall = mockTemplateConstructor.mock.calls[0]?.[0];
		expect(templateCall.originLeaf).toBe(originLeaf);
		expect(templateCall.context).toBe(macroCall.context);
	});
});
