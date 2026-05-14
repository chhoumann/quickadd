import { describe, expect, it, vi } from "vitest";
import { CompleteFormatter } from "./completeFormatter";
import type {
	CompleteFormatterEvaluators,
	FormatterVariables,
} from "./formatterEvaluators";
import { MacroAbortError } from "../errors/MacroAbortError";

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

function makeExecutor(variables: FormatterVariables) {
	return {
		variables,
		signalAbort: vi.fn(),
	} as any;
}

function makePlugin() {
	return {
		settings: {
			choices: [],
			globalVariables: {
				global: "{{VALUE:fromGlobal}}",
			},
			enableTemplatePropertyTypes: false,
		},
	} as any;
}

describe("CompleteFormatter evaluator boundaries", () => {
	it("delegates macro, template, and inline tokens with same variables map and ordered processing", async () => {
		const variables = new Map<string, unknown>([
			["fromGlobal", "global-value"],
		]);
		const calls: string[] = [];
		const observedMaps: FormatterVariables[] = [];
		const evaluators: CompleteFormatterEvaluators = {
			inlineJavaScript: {
				evaluateInlineJavaScript: async (code, context) => {
					calls.push(`inline:${code}`);
					observedMaps.push(context.variables);
					context.variables.set("fromInline", "inline-value");
					return "{{MACRO:Next|label:Macro label}}";
				},
			},
			macro: {
				evaluateMacro: async (macroName, context) => {
					calls.push(`macro:${macroName}:${context.label ?? ""}`);
					observedMaps.push(context.variables);
					context.variables.set("fromMacro", "macro-value");
					return "{{TEMPLATE:Templates/Example.md}}";
				},
			},
			template: {
				evaluateTemplate: async (templatePath, context) => {
					calls.push(`template:${templatePath}`);
					observedMaps.push(context.variables);
					context.variables.set("fromTemplate", "template-value");
					return [
						"{{GLOBAL_VAR:global}}",
						"{{VALUE:fromInline}}",
						"{{VALUE:fromMacro}}",
						"{{VALUE:fromTemplate}}",
						"```js quickadd\nreturn 'late';\n```",
						"{{MACRO:Late}}",
					].join("|");
				},
			},
		};

		const formatter = new CompleteFormatter(
			app,
			makePlugin(),
			makeExecutor(variables),
			undefined,
			evaluators,
		);

		await expect(
			formatter.formatFileContent("```js quickadd\nreturn 'first';\n```"),
		).resolves.toBe(
			[
				"global-value",
				"inline-value",
				"macro-value",
				"template-value",
				"```js quickadd\nreturn 'late';\n```",
				"{{MACRO:Late}}",
			].join("|"),
		);
		expect(calls).toEqual([
			"inline:return 'first';",
			"macro:Next:Macro label",
			"template:Templates/Example.md",
		]);
		expect(observedMaps).toEqual([variables, variables, variables]);
	});

	it("maps nullish macro and non-string inline results to empty strings", async () => {
		const evaluators: CompleteFormatterEvaluators = {
			inlineJavaScript: {
				evaluateInlineJavaScript: async () => 42,
			},
			macro: {
				evaluateMacro: async () => null,
			},
			template: {
				evaluateTemplate: async () => "",
			},
		};
		const formatter = new CompleteFormatter(
			app,
			makePlugin(),
			makeExecutor(new Map()),
			undefined,
			evaluators,
		);

		await expect(
			formatter.formatFileContent("a```js quickadd\nreturn 42;\n```b{{MACRO:None}}c"),
		).resolves.toBe("abc");
	});

	it("propagates runtime evaluator errors and aborts", async () => {
		const abort = new MacroAbortError("stop");
		const evaluators: CompleteFormatterEvaluators = {
			inlineJavaScript: {
				evaluateInlineJavaScript: async () => {
					throw abort;
				},
			},
			macro: {
				evaluateMacro: async () => "",
			},
			template: {
				evaluateTemplate: async () => "",
			},
		};
		const formatter = new CompleteFormatter(
			app,
			makePlugin(),
			makeExecutor(new Map()),
			undefined,
			evaluators,
		);

		await expect(formatter.formatFileContent("```js quickadd\nthrow new Error();\n```"))
			.rejects.toBe(abort);
	});
});
