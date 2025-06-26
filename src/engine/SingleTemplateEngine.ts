import { TemplateEngine } from "./TemplateEngine";
import type { App } from "obsidian";
import type QuickAdd from "../main";
import type { IChoiceExecutor } from "../IChoiceExecutor";
import { log } from "../logger/logManager";
import { TemplateProcessingError } from "../errors/templateProcessingError";

export class SingleTemplateEngine extends TemplateEngine {
	constructor(
		app: App,
		plugin: QuickAdd,
		private templatePath: string,
		choiceExecutor?: IChoiceExecutor
	) {
		super(app, plugin, choiceExecutor);
	}
	public async run(): Promise<string> {
		try {
			let templateContent: string = await this.getTemplateContent(
				this.templatePath
			);

			if (!templateContent) {
				throw new TemplateProcessingError(this.templatePath, "EMPTY_TEMPLATE");
			}

			templateContent = await this.formatter.formatFileContent(
				templateContent
			);

			return templateContent;
		} catch (err) {
			// Wrap any unknown errors as TemplateProcessingError
			if (err instanceof TemplateProcessingError) throw err;
			throw new TemplateProcessingError(
				this.templatePath,
				err instanceof Error ? err.message : String(err)
			);
		}
	}
}
