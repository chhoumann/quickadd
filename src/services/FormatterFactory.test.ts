import { describe, expect, it, vi } from "vitest";
import { FormatterFactory } from "./FormatterFactory";

vi.mock("src/gui/GenericInputPrompt/GenericInputPrompt", () => ({
	default: { PromptWithContext: vi.fn() },
}));
vi.mock("src/gui/InputSuggester/inputSuggester", () => ({
	default: { Suggest: vi.fn() },
}));
vi.mock("src/gui/VDateInputPrompt/VDateInputPrompt", () => ({
	default: { Prompt: vi.fn() },
}));
vi.mock("../gui/GenericSuggester/genericSuggester", () => ({
	default: { Suggest: vi.fn() },
}));
vi.mock("../gui/InputPrompt", () => ({
	default: class {
		factory() {
			return { Prompt: vi.fn(), PromptWithContext: vi.fn() };
		}
	},
}));
vi.mock("../gui/MathModal", () => ({
	MathModal: { Prompt: vi.fn() },
}));
vi.mock("../utils/FieldValueCollector", () => ({
	collectFieldValuesProcessedDetailed: vi.fn(async () => ({
		values: [],
		hasDefaultValue: false,
	})),
	collectFieldValuesRaw: vi.fn(async () => new Set()),
	generateFieldCacheKey: vi.fn(() => "cache-key"),
}));
vi.mock("../utils/FieldValueProcessor", () => ({
	FieldValueProcessor: { getSmartDefaults: vi.fn(() => []) },
}));

const app = {
	workspace: {
		getActiveViewOfType: vi.fn(() => null),
		getActiveFile: vi.fn(() => null),
	},
	fileManager: {
		generateMarkdownLink: vi.fn(),
	},
} as any;

const plugin = {
	settings: {
		choices: [],
		globalVariables: {},
		enableTemplatePropertyTypes: false,
	},
} as any;

describe("FormatterFactory runtime evaluator wiring", () => {
	it("delegates macro and inline JavaScript tokens through the choice executor seam", async () => {
		const variables = new Map<string, unknown>();
		const evaluateMacroToken = vi.fn(async (_macroName, context) => {
			expect(context.variables).toBe(variables);
			context.variables.set("fromMacro", "macro-value");
			return "{{VALUE:fromInline}}";
		});
		const evaluateInlineJavaScriptToken = vi.fn(async (_code, context) => {
			expect(context.variables).toBe(variables);
			context.variables.set("fromInline", "inline-value");
			return "{{MACRO:Example}}";
		});
		const choiceExecutor = {
			variables,
			evaluateMacroToken,
			evaluateInlineJavaScriptToken,
		} as any;

		const formatter = new FormatterFactory(
			app,
			plugin,
		).createCompleteFormatter(choiceExecutor);

		await expect(
			formatter.formatFileContent("```js quickadd\nreturn 'token';\n```"),
		).resolves.toBe("inline-value");
		expect(evaluateInlineJavaScriptToken).toHaveBeenCalledWith(
			"return 'token';",
			{ variables },
		);
		expect(evaluateMacroToken).toHaveBeenCalledWith("Example", { variables });
		expect(variables.get("fromMacro")).toBe("macro-value");
	});
});
