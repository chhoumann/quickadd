import type { App } from "obsidian";
import type { IChoiceExecutor } from "../IChoiceExecutor";
import type QuickAdd from "../main";
import type { IDateParser } from "../parsers/IDateParser";
import { CompleteFormatter } from "../formatters/completeFormatter";
import { FormatDisplayFormatter } from "../formatters/formatDisplayFormatter";
import type {
	CompleteFormatterEvaluators,
	FormatDisplayFormatterEvaluators,
	FormatterVariables,
} from "../formatters/formatterEvaluators";
import { TemplateEvaluator, TemplateFileService } from "./TemplateFileService";

export class FormatterFactory {
	constructor(
		private readonly app: App,
		private readonly plugin: QuickAdd,
	) {}

	public createCompleteFormatter(
		choiceExecutor?: IChoiceExecutor,
		dateParser?: IDateParser,
	): CompleteFormatter {
		return new CompleteFormatter(
			this.app,
			this.plugin,
			choiceExecutor,
			dateParser,
			this.createCompleteEvaluators(choiceExecutor),
		);
	}

	public createDisplayFormatter(dateParser?: IDateParser): FormatDisplayFormatter {
		return new FormatDisplayFormatter(
			this.app,
			this.plugin,
			dateParser,
			this.createDisplayEvaluators(),
		);
	}

	private createCompleteEvaluators(
		choiceExecutor?: IChoiceExecutor,
	): CompleteFormatterEvaluators {
		return {
			macro: {
				evaluateMacro: async (macroName, context) => {
					const executor = this.requireChoiceExecutor(choiceExecutor);
					const { SingleMacroEngine } = await import(
						"../engine/SingleMacroEngine"
					);
					const engine = new SingleMacroEngine(
						this.app,
						this.plugin,
						this.plugin.settings.choices,
						executor,
						context.variables,
					);
					return await engine.runAndGetOutput(
						macroName,
						context.label ? { label: context.label } : undefined,
					);
				},
			},
			template: {
				evaluateTemplate: async (templatePath, context) => {
					const formatter = this.createCompleteFormatter(
						this.withVariables(choiceExecutor, context.variables),
					);
					const templateFileService = new TemplateFileService(this.app);
					const templateContent =
						await templateFileService.readTemplateContent(templatePath);
					const { content } = await new TemplateEvaluator(
						formatter,
					).evaluateTemplateContent(templateContent, templatePath);
					return content;
				},
			},
			inlineJavaScript: {
				evaluateInlineJavaScript: async (code, context) => {
					const { SingleInlineScriptEngine } = await import(
						"../engine/SingleInlineScriptEngine"
					);
					const executor = new SingleInlineScriptEngine(
						this.app,
						this.plugin,
						this.requireChoiceExecutor(choiceExecutor),
						context.variables,
					);
					return await executor.runAndGetOutput(code);
				},
			},
		};
	}

	private createDisplayEvaluators(): FormatDisplayFormatterEvaluators {
		return {
			template: {
				evaluateTemplate: async (templatePath) => {
					return await new TemplateFileService(this.app).previewTemplateContent(
						templatePath,
					);
				},
			},
		};
	}

	private requireChoiceExecutor(
		choiceExecutor: IChoiceExecutor | undefined,
	): IChoiceExecutor {
		if (!choiceExecutor) {
			throw new Error("Choice executor is required for runtime evaluation.");
		}
		return choiceExecutor;
	}

	private withVariables(
		choiceExecutor: IChoiceExecutor | undefined,
		variables: FormatterVariables,
	): IChoiceExecutor | undefined {
		if (!choiceExecutor) return undefined;
		choiceExecutor.variables = variables;
		return choiceExecutor;
	}
}
