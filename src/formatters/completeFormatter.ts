import { Formatter } from "./formatter";
import type { App } from "obsidian";
import { getNaturalLanguageDates } from "../utility";
import GenericSuggester from "../gui/GenericSuggester/genericSuggester";
import type QuickAdd from "../main";
import { SingleMacroEngine } from "../engine/SingleMacroEngine";
import { SingleTemplateEngine } from "../engine/SingleTemplateEngine";
import { MarkdownView } from "obsidian";
import type { IChoiceExecutor } from "../IChoiceExecutor";
import { INLINE_JAVASCRIPT_REGEX } from "../constants";
import { SingleInlineScriptEngine } from "../engine/SingleInlineScriptEngine";
import { MathModal } from "../gui/MathModal";
import InputPrompt from "../gui/InputPrompt";
import GenericInputPrompt from "src/gui/GenericInputPrompt/GenericInputPrompt";
import InputSuggester from "src/gui/InputSuggester/inputSuggester";

export class CompleteFormatter extends Formatter {
	private valueHeader: string;

	constructor(
		protected app: App,
		private plugin: QuickAdd,
		protected choiceExecutor?: IChoiceExecutor
	) {
		super();
		if (choiceExecutor) {
			this.variables = choiceExecutor?.variables;
		}
	}

	protected async format(input: string): Promise<string> {
		let output: string = input;

		output = await this.replaceInlineJavascriptInString(output);
		output = await this.replaceMacrosInString(output);
		output = await this.replaceTemplateInString(output);
		output = this.replaceDateInString(output);
		output = await this.replaceValueInString(output);
		output = await this.replaceDateVariableInString(output);
		output = await this.replaceVariableInString(output);
		output = await this.replaceFieldVarInString(output);
		output = await this.replaceMathValueInString(output);

		return output;
	}

	async formatFileName(input: string, valueHeader: string): Promise<string> {
		this.valueHeader = valueHeader;
		return await this.format(input);
	}

	async formatFileContent(input: string): Promise<string> {
		let output: string = input;

		output = await this.format(output);
		output = await this.replaceLinkToCurrentFileInString(output);

		return output;
	}

	async formatFolderPath(folderName: string): Promise<string> {
		return await this.format(folderName);
	}

	protected getCurrentFileLink(): string | null {
		const currentFile = this.app.workspace.getActiveFile();
		if (!currentFile) return null;

		return this.app.fileManager.generateMarkdownLink(currentFile, "");
	}

	protected getNaturalLanguageDates() {
		return getNaturalLanguageDates(this.app);
	}

	protected getVariableValue(variableName: string): string {
		return this.variables.get(variableName) as string;
	}

	protected async promptForValue(header?: string): Promise<string> {
		if (!this.value) {
			const selectedText: string = await this.getSelectedText();
			this.value = selectedText
				? selectedText
				: await new InputPrompt()
						.factory()
						.Prompt(this.app, this.valueHeader ?? `Enter value`);
		}

		return this.value;
	}

	protected async promptForVariable(header?: string): Promise<string> {
		return await new InputPrompt()
			.factory()
			.Prompt(this.app, header as string);
	}

	protected async promptForMathValue(): Promise<string> {
		return await MathModal.Prompt();
	}

	protected async suggestForValue(suggestedValues: string[]) {
		return await GenericSuggester.Suggest(
			this.app,
			suggestedValues,
			suggestedValues
		);
	}

	protected async suggestForField(variableName: string) {
		const suggestedValues = new Set<string>()

		for (const file of this.app.vault.getMarkdownFiles()) {
			const cache = this.app.metadataCache.getFileCache(file);
			const value = cache?.frontmatter?.[variableName];
			if (!value || typeof value == "object") continue;
			
			suggestedValues.add(value.toString());
		}

		if (suggestedValues.size === 0) {
			return await GenericInputPrompt.Prompt(
				app,
				`Enter value for ${variableName}`,
				`No existing values were found in your vault.`
			);
		}

		const suggestedValuesArr = Array.from(suggestedValues);

		return await InputSuggester.Suggest(
			this.app,
			suggestedValuesArr,
			suggestedValuesArr,
			{
				placeholder: `Enter value for ${variableName}`
			}
		);
	}

	protected async getMacroValue(macroName: string): Promise<string> {
		const macroEngine: SingleMacroEngine = new SingleMacroEngine(
			this.app,
			this.plugin,
			this.plugin.settings.macros,
			//@ts-ignore
			this.choiceExecutor,
			this.variables
		);
		const macroOutput =
			(await macroEngine.runAndGetOutput(macroName)) ?? "";

		Object.keys(macroEngine.params.variables).forEach((key) => {
			this.variables.set(key, macroEngine.params.variables[key]);
		});

		return macroOutput;
	}

	protected async getTemplateContent(templatePath: string): Promise<string> {
		return await new SingleTemplateEngine(
			this.app,
			this.plugin,
			templatePath,
			this.choiceExecutor
		).run();
	}

	protected async getSelectedText(): Promise<string> {
		const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
		if (!activeView) return "";

		return activeView.editor.getSelection();
	}

	protected async replaceInlineJavascriptInString(input: string) {
		let output: string = input;

		while (INLINE_JAVASCRIPT_REGEX.test(output)) {
			const match = INLINE_JAVASCRIPT_REGEX.exec(output);
			const code = match?.at(1)?.trim();

			if (code) {
				const executor = new SingleInlineScriptEngine(
					this.app,
					this.plugin,
					//@ts-ignore
					this.choiceExecutor,
					this.variables
				);
				const outVal: unknown = await executor.runAndGetOutput(code);

				for (const key in executor.params.variables) {
					this.variables.set(key, executor.params.variables[key]);
				}

				output =
					typeof outVal === "string"
						? this.replacer(output, INLINE_JAVASCRIPT_REGEX, outVal)
						: this.replacer(output, INLINE_JAVASCRIPT_REGEX, "");
			}
		}

		return output;
	}
}
