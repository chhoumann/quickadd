import { beforeEach, describe, expect, it, vi } from "vitest";
import type IChoice from "./types/choices/IChoice";
import type IMacroChoice from "./types/choices/IMacroChoice";
import type { IMacro } from "./types/macros/IMacro";
import { CommandType } from "./types/macros/CommandType";
import { MacroAbortError } from "./errors/MacroAbortError";
import { createChoiceExecutionResult } from "./engine/runtime";

const {
	mockGetOpenFileOriginLeaf,
	mockTemplateConstructor,
	mockMacroConstructor,
	mockMacroRunResult,
	mockChoiceSuggesterOpen,
} = vi.hoisted(() => ({
	mockGetOpenFileOriginLeaf: vi.fn(),
	mockTemplateConstructor: vi.fn(),
	mockMacroConstructor: vi.fn(),
	mockMacroRunResult: vi.fn(),
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
			const overrideResult = mockMacroRunResult();
			if (overrideResult) return overrideResult;

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
		mockMacroRunResult.mockReturnValue(undefined);
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

	it("preserves an already-aborted macro result when a pending abort signal exists", async () => {
		const app = { plugins: { plugins: {} } } as any;
		const plugin = {} as any;
		const executor = new ChoiceExecutor(app, plugin);
		const pendingAbort = new MacroAbortError("Pending child abort");
		const engineError = new Error("Macro child aborted with context");
		const macroChoice: IMacroChoice = {
			id: "macro-choice",
			name: "Macro",
			type: "Macro",
			command: false,
			runOnStartup: false,
			macro: {
				id: "macro",
				name: "Macro",
				commands: [],
			} as IMacro,
		};
		mockMacroRunResult.mockImplementationOnce(() => {
			executor.signalAbort(pendingAbort);
			return createChoiceExecutionResult({
				status: "aborted",
				choiceId: macroChoice.id,
				stepId: "engine-step",
				error: engineError,
				diagnostics: [
					{
						severity: "error",
						code: "engine-aborted",
						message: "Engine aborted with step context",
						source: "runtime",
					},
				],
			});
		});

		const result = await executor.execute(macroChoice);

		expect(result.status).toBe("aborted");
		expect(result.stepId).toBe("engine-step");
		expect(result.error).toBe(engineError);
		expect(result.diagnostics).toEqual([
			expect.objectContaining({ code: "engine-aborted" }),
		]);
		expect(executor.consumeAbortSignal()).toBeNull();
	});

	it("snapshots runtime context arrays when creating choice results", async () => {
		const app = { plugins: { plugins: {} } } as any;
		const plugin = {} as any;
		const templateChoice: IChoice = {
			id: "template-choice",
			name: "Template",
			type: "Template",
			command: false,
		};

		const executor = new ChoiceExecutor(app, plugin);
		const result = await executor.execute(templateChoice);
		const templateCall = mockTemplateConstructor.mock.calls[0]?.[0];

		templateCall.context.addDiagnostic({
			severity: "info",
			code: "late-context-mutation",
			message: "Added after result creation",
			source: "runtime",
		});
		templateCall.context.addArtifact({
			id: "late-artifact",
			kind: "custom",
			label: "Late artifact",
			createdAt: 1,
		});

		expect(result.status).toBe("success");
		expect(result.diagnostics).toHaveLength(0);
		expect(result.artifacts).toHaveLength(0);
	});

	it("returns macro engine aborted results without a pending abort signal", async () => {
		const app = { plugins: { plugins: {} } } as any;
		const plugin = {} as any;
		const abortError = new Error("Macro child aborted");
		const macroChoice: IMacroChoice = {
			id: "macro-choice",
			name: "Macro",
			type: "Macro",
			command: false,
			runOnStartup: false,
			macro: {
				id: "macro",
				name: "Macro",
				commands: [],
			} as IMacro,
		};
		mockMacroRunResult.mockReturnValueOnce(
			createChoiceExecutionResult({
				status: "aborted",
				choiceId: macroChoice.id,
				error: abortError,
			}),
		);

		const executor = new ChoiceExecutor(app, plugin);
		const result = await executor.execute(macroChoice);

		expect(result.status).toBe("aborted");
		expect(result.error).toBe(abortError);
		expect(executor.consumeAbortSignal()).toBeNull();
	});
});
