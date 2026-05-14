export type FormatterVariables = Map<string, unknown>;

export interface FormatterEvaluatorContext {
	variables: FormatterVariables;
	label?: string;
}

export interface MacroTokenEvaluator {
	evaluateMacro(
		macroName: string,
		context: FormatterEvaluatorContext,
	): Promise<unknown>;
}

export interface TemplateTokenEvaluator {
	evaluateTemplate(
		templatePath: string,
		context: FormatterEvaluatorContext,
	): Promise<string>;
}

export interface InlineJavaScriptTokenEvaluator {
	evaluateInlineJavaScript(
		code: string,
		context: FormatterEvaluatorContext,
	): Promise<unknown>;
}

export interface CompleteFormatterEvaluators {
	macro: MacroTokenEvaluator;
	template: TemplateTokenEvaluator;
	inlineJavaScript: InlineJavaScriptTokenEvaluator;
}

export interface FormatDisplayFormatterEvaluators {
	template: TemplateTokenEvaluator;
}
