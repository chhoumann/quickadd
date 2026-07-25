import { TemplateEngine } from "./TemplateEngine";
import type { App } from "obsidian";
import type QuickAdd from "../main";
import type { IChoiceExecutor } from "../IChoiceExecutor";
import { log } from "../logger/logManager";
import type { TemplateInclusionState } from "../formatters/formatter";
import type { PromptScopeKind } from "../formatters/promptScope";

export class SingleTemplateEngine extends TemplateEngine {
	/**
	 * What the rendered template becomes. Defaults to the note's body, but a
	 * `{{TEMPLATE:...}}` spliced into a FILE NAME or folder is part of that path,
	 * so its prompts must not claim to be asking for note content (issue #1546).
	 */
	private promptScope: PromptScopeKind = "noteBody";

	constructor(
		app: App,
		plugin: QuickAdd,
		private templatePath: string,
		choiceExecutor?: IChoiceExecutor,
		inclusion?: TemplateInclusionState,
	) {
		super(app, plugin, choiceExecutor, inclusion);
	}

	public setPromptScope(scope: PromptScopeKind): void {
		this.promptScope = scope;
	}
	public async run(): Promise<string> {
		// Resolve format tokens in the template path (issue #620) before reading.
		const resolvedTemplatePath = await this.resolveTemplateSourcePath(
			this.templatePath,
		);
		let templateContent: string = await this.getTemplateContent(
			resolvedTemplatePath
		);
		if (!templateContent) {
			log.logError(`Template ${resolvedTemplatePath} not found.`);
		}

		templateContent = await this.formatter.withTemplatePropertyCollection(() =>
			this.formatter.withPromptScope(this.promptScope, templateContent, () =>
				this.formatter.formatFileContent(templateContent),
			),
		);

		return templateContent;
	}

	/**
	 * Returns the template variables that should be processed as proper property types.
	 * Note: This method clears the internal state after returning the variables.
	 */
	public getAndClearTemplatePropertyVars(): Map<string, unknown> {
		return this.formatter.getAndClearTemplatePropertyVars();
	}
}
