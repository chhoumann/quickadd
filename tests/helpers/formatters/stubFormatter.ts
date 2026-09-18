import type { App } from "obsidian";
import { Formatter } from "../../../src/formatters/formatter";

/** Inert defaults let token tests implement only the collaborators they exercise. */
export class StubFormatter extends Formatter {
	public constructor(app?: App) { super(app); }
	protected async format(input: string): Promise<string> { return input; }
	protected getCurrentFileLink(): string | null { return null; }
	protected getCurrentFileName(): string | null { return null; }
	protected promptForValue(..._args: Parameters<Formatter["promptForValue"]>): Promise<string> | string { return ""; }
	protected async promptForMathValue(): Promise<string> { return ""; }
	protected getVariableValue(_name: string): string { return ""; }
	protected suggestForValue(..._args: Parameters<Formatter["suggestForValue"]>): Promise<string> | string { return ""; }
	protected suggestForFile(..._args: Parameters<Formatter["suggestForFile"]>): Promise<string | string[]> | string | string[] { return ""; }
	protected async suggestForField(..._args: Parameters<Formatter["suggestForField"]>): Promise<string | string[]> { return ""; }
	protected getMacroValue(..._args: Parameters<Formatter["getMacroValue"]>): Promise<string> | string { return ""; }
	protected async promptForVariable(..._args: Parameters<Formatter["promptForVariable"]>): Promise<string> { return ""; }
	protected async getTemplateContent(..._args: Parameters<Formatter["getTemplateContent"]>): Promise<string> { return ""; }
	protected async getSelectedText(): Promise<string> { return ""; }
	protected async getClipboardContent(): Promise<string> { return ""; }
	protected isTemplatePropertyTypesEnabled(): boolean { return false; }
}
