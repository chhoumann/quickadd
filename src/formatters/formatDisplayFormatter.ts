import { Formatter } from "./formatter";
import type { App } from "obsidian";
import { getNaturalLanguageDates } from "../utility";
import type QuickAdd from "../main";
import { SingleTemplateEngine } from "../engine/SingleTemplateEngine";

export class FormatDisplayFormatter extends Formatter {
	constructor(private app: App, private plugin: QuickAdd) {
		super();
	}

	public async format(input: string): Promise<string> {
		let output: string = input;

		output = this.replaceDateInString(output);
		output = await this.replaceValueInString(output);
		output = await this.replaceDateVariableInString(output);
		output = await this.replaceVariableInString(output);
		output = await this.replaceLinkToCurrentFileInString(output);
		output = await this.replaceMacrosInString(output);
		output = await this.replaceTemplateInString(output);
		output = this.replaceLinebreakInString(output);

		return output;
	}
	protected promptForValue(header?: string): string {
		return "_value_";
	}

	protected getVariableValue(variableName: string): string {
		return variableName;
	}

	protected getCurrentFileLink() {
		return this.app.workspace.getActiveFile()?.path ?? "_noPageOpen_";
	}

	protected getNaturalLanguageDates() {
		return getNaturalLanguageDates(this.app);
	}

	protected suggestForValue(suggestedValues: string[]) {
		return "_suggest_";
	}

	protected getMacroValue(macroName: string) {
		return `_macro: ${macroName}_`;
	}

	protected promptForMathValue(): Promise<string> {
		return Promise.resolve("_math_");
	}

	protected promptForVariable(variableName: string): Promise<string> {
		return Promise.resolve(`${variableName}_`);
	}

	protected async getTemplateContent(templatePath: string): Promise<string> {
		try {
			return await new SingleTemplateEngine(
				this.app,
				this.plugin,
				templatePath,
				undefined
			).run();
		} catch (e) {
			return `Template (not found): ${templatePath}`;
		}
	}

	protected async getSelectedText(): Promise<string> {
		return "_selected_";
	}
}
