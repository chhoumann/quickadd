import { beforeEach, describe, expect, it, vi } from "vitest";
import type { App } from "obsidian";
import { CaptureChoiceFormatter } from "./captureChoiceFormatter";
import { FormatterFactory } from "../services/FormatterFactory";

const { promptMock } = vi.hoisted(() => ({
	promptMock: vi.fn().mockResolvedValue("prompted"),
}));

vi.mock("../gui/InputPrompt", () => ({
	__esModule: true,
	default: class {
		factory() {
			return {
				Prompt: promptMock,
				PromptWithContext: promptMock,
			} as any;
		}
	},
}));

vi.mock("../quickAddSettingsTab", () => ({
	QuickAddSettingsTab: class {},
}));

vi.mock("../main", () => ({
	__esModule: true,
	default: class QuickAddMock {},
}));

vi.mock("obsidian-dataview", () => ({
	__esModule: true,
	getAPI: vi.fn().mockReturnValue(null),
}));

const createFormatter = (
	selection: string | null,
	variables?: Map<string, unknown>,
) => {
	const app = {
		workspace: {
			getActiveViewOfType: vi.fn().mockReturnValue(
				selection === null
					? null
					: {
							editor: {
								getSelection: () => selection,
							},
						},
			),
			getActiveFile: vi.fn().mockReturnValue(null),
		},
	} as unknown as App;

	const plugin = {
		settings: {
			inputPrompt: "single-line",
			enableTemplatePropertyTypes: false,
			globalVariables: {},
			useSelectionAsCaptureValue: true,
		},
	} as any;

	const choiceExecutor = variables
		? ({ execute: vi.fn(), variables } as any)
		: undefined;

	return new CaptureChoiceFormatter(app, plugin, choiceExecutor);
};

const createFactoryFormatter = (choiceExecutor: any) => {
	const app = {
		workspace: {
			getActiveViewOfType: vi.fn().mockReturnValue(null),
			getActiveFile: vi.fn().mockReturnValue(null),
		},
	} as unknown as App;

	const plugin = {
		settings: {
			inputPrompt: "single-line",
			enableTemplatePropertyTypes: false,
			globalVariables: {},
			useSelectionAsCaptureValue: true,
		},
	} as any;

	return new FormatterFactory(app, plugin).createCaptureChoiceFormatter(
		choiceExecutor,
	);
};

describe("CaptureChoiceFormatter selection-as-value behavior", () => {
	beforeEach(() => {
		promptMock.mockClear();
	});

	it("uses selection for {{VALUE}} when enabled", async () => {
		const formatter = createFormatter("Selected text");
		formatter.setUseSelectionAsCaptureValue(true);

		const result = await formatter.formatContentOnly("{{VALUE}}");

		expect(result).toBe("Selected text");
		expect(promptMock).not.toHaveBeenCalled();
	});

	it("prompts for {{VALUE}} when selection use is disabled", async () => {
		const formatter = createFormatter("Selected text");
		formatter.setUseSelectionAsCaptureValue(false);

		const result = await formatter.formatContentOnly(
			"Value: {{VALUE}} / Selected: {{SELECTED}}",
		);

		expect(result).toBe("Value: prompted / Selected: Selected text");
		expect(promptMock).toHaveBeenCalledTimes(1);
	});

	it("treats whitespace-only selection as empty when enabled", async () => {
		const formatter = createFormatter("   \n\t ");
		formatter.setUseSelectionAsCaptureValue(true);

		const result = await formatter.formatContentOnly("{{VALUE}}");

		expect(result).toBe("prompted");
		expect(promptMock).toHaveBeenCalledTimes(1);
	});

	it("uses raw mapped VALUE variables supplied by one-page preflight", async () => {
		const formatter = createFormatter(
			null,
			new Map([
				["#BF616A,#8CC570,#42A5F5", "#BF616A"],
			]),
		);

		const result = await formatter.formatContentOnly(
			'<mark style="background-color: {{VALUE:#BF616A,#8CC570,#42A5F5|text:red,green,blue}}">selected</mark>',
		);

		expect(result).toContain("background-color: #BF616A");
		expect(promptMock).not.toHaveBeenCalled();
	});

	it("evaluates macro tokens through the runtime choice executor with shared variables", async () => {
		const variables = new Map<string, unknown>([["before", "start"]]);
		const choiceExecutor = {
			execute: vi.fn(),
			variables,
			evaluateMacroToken: vi.fn().mockImplementation(
				async (macroName: string, context: { variables: Map<string, unknown> }) => {
					expect(macroName).toBe("Capture Macro");
					expect(context.variables).toBe(variables);
					context.variables.set("macroResult", "shared");
					return "macro-output";
				},
			),
			evaluateInlineJavaScriptToken: vi.fn(),
		};

		const formatter = createFactoryFormatter(choiceExecutor);

		const result = await formatter.formatContentOnly(
			"{{MACRO:Capture Macro}} {{VALUE:macroResult}}",
		);

		expect(result).toBe("macro-output shared");
		expect(choiceExecutor.evaluateMacroToken).toHaveBeenCalledTimes(1);
		expect(promptMock).not.toHaveBeenCalled();
	});

	it("evaluates inline JavaScript tokens through the runtime choice executor with shared variables", async () => {
		const variables = new Map<string, unknown>([["input", "value"]]);
		const choiceExecutor = {
			execute: vi.fn(),
			variables,
			evaluateMacroToken: vi.fn(),
			evaluateInlineJavaScriptToken: vi.fn().mockImplementation(
				async (code: string, context: { variables: Map<string, unknown> }) => {
					expect(code).toBe('variables.set("inlineResult", "shared"); "inline-output";');
					expect(context.variables).toBe(variables);
					context.variables.set("inlineResult", "shared");
					return "inline-output";
				},
			),
		};

		const formatter = createFactoryFormatter(choiceExecutor);

		const result = await formatter.formatContentOnly(
			'```js quickadd\nvariables.set("inlineResult", "shared"); "inline-output";\n``` {{VALUE:inlineResult}}',
		);

		expect(result).toBe("inline-output shared");
		expect(choiceExecutor.evaluateInlineJavaScriptToken).toHaveBeenCalledTimes(1);
		expect(promptMock).not.toHaveBeenCalled();
	});
});
