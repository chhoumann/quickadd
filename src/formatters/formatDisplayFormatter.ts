import { Formatter, type PromptContext } from "./formatter";
import type { App } from "obsidian";
import type QuickAdd from "../main";
import { SingleTemplateEngine } from "../engine/SingleTemplateEngine";
import { DATE_VARIABLE_REGEX, GLOBAL_VAR_REGEX } from "../constants";
import type { IDateParser } from "../parsers/IDateParser";
import { NLDParser } from "../parsers/NLDParser";
import {
	getVariableExample,
	getMacroPreview,
	getVariablePromptExample,
	getSuggestionPreview,
	getCurrentFileLinkPreview,
	getCurrentFileLinkToSectionPreview,
	getCurrentFileNamePreview,
	getCurrentFolderPathPreview,
	DateFormatPreviewGenerator
} from "./helpers/previewHelpers";
import { getValueVariableBaseName } from "../utils/valueSyntax";
import { parseVDateOptions } from "../utils/vdateSyntax";
import { EnhancedFieldSuggestionFileFilter } from "../utils/EnhancedFieldSuggestionFileFilter";
import { FILE_CUSTOM_PREFIX, FILE_PICK_PREFIX, type ParsedFileToken } from "../utils/fileSyntax";

export class FormatDisplayFormatter extends Formatter {
	constructor(
		app: App,
		private readonly plugin: QuickAdd,
		dateParser?: IDateParser,
		// Line-target fields (insert-after/before) preview with
		// { resolveActiveFolder: false }: their runtime path
		// (formatLocationString) deliberately leaves {{foldercurrent}} literal,
		// so the preview must too — otherwise a manually typed or imported
		// selector previews as a resolved folder while the capture searches for
		// the literal token.
		private readonly opts: { resolveActiveFolder?: boolean } = {},
	) {
		super(app);
		this.dateParser = dateParser || NLDParser;
	}

	public async format(input: string): Promise<string> {
		let output: string = input;

		try {
			// Expand global variables first so previews include their content
			output = await this.replaceGlobalVarInString(output);
			// Mirror CaptureChoiceFormatter: linebreak escapes are format-template
			// material (including global snippets) and expand before token
			// substitution, never on substituted content (issue #527).
			output = this.expandLinebreakEscapesOutsideTokens(output);
			output = this.replaceDateInString(output);
			output = this.replaceTimeInString(output);
			output = await this.replaceValueInString(output);
			output = await this.replaceSelectedInString(output);
			output = await this.replaceClipboardInString(output);
			output = await this.replaceDateVariableInString(output);
			output = await this.replaceVariableInString(output);
			// Links + {{filenamecurrent}} + {{folder}} + {{foldercurrent}} in one
			// pass so no token re-scans another's output (#1358). ({{title}} has
			// never been resolved in this preview formatter — preserved by omitting
			// it.) The preview resolver never returns null, so no throw here.
			output = this.replaceCurrentFileTokensInString(output, {
				links: true,
				fileName: true,
				folder: true,
				...(this.opts.resolveActiveFolder === false
					? {}
					: { activeFolder: "content" as const }),
			});
			output = await this.replaceMacrosInString(output);
			output = await this.replaceTemplateInString(output);
			output = await this.replaceFieldVarInString(output);
			output = await this.replaceFileInString(output);
			output = this.replaceRandomInString(output);
		} catch {
			// Return the input as-is if formatting fails during preview
			// This prevents crashes when typing incomplete syntax
			return input;
		}

		return output;
	}

	protected async replaceGlobalVarInString(input: string): Promise<string> {
		let output = input;
		let guard = 0;
		const re = new RegExp(GLOBAL_VAR_REGEX.source, 'gi');
		while (re.test(output)) {
			if (++guard > 5) break;
			output = output.replace(re, (_m, rawName) => {
				const name = String(rawName ?? '').trim();
				if (!name) return _m;
				const snippet = this.plugin?.settings?.globalVariables?.[name];
				return typeof snippet === 'string' ? snippet : '';
			});
		}
		return output;
	}
	protected promptForValue(header?: string): string {
		return header || "user input";
	}

	protected getVariableValue(variableName: string): string {
		const stored = this.variables.get(variableName);
		if (typeof stored === "string") return stored;
		const baseName = getValueVariableBaseName(variableName);
		return getVariableExample(baseName);
	}

	protected getCurrentFileLink(): string | null {
		if (!this.app) return null;
		return getCurrentFileLinkPreview(this.app.workspace.getActiveFile());
	}

	protected getCurrentFileLinkToSection(): string | null {
		if (!this.app) return getCurrentFileLinkToSectionPreview(null);
		return getCurrentFileLinkToSectionPreview(
			this.app.workspace.getActiveFile(),
		);
	}

	protected getCurrentFileName(): string | null {
		if (!this.app) return "current_filename";
		return getCurrentFileNamePreview(this.app.workspace.getActiveFile());
	}

	protected getCurrentFolderPath(): string | null {
		if (!this.app) return "current_folder";
		return getCurrentFolderPathPreview(this.app.workspace.getActiveFile());
	}

	protected suggestForValue(
		suggestedValues: string[],
		allowCustomInput = false,
		context?: {
			placeholder?: string;
			variableKey?: string;
			displayValues?: string[];
		},
	) {
		return getSuggestionPreview(context?.displayValues ?? suggestedValues);
	}

	protected getMacroValue(
		macroName: string,
		_context?: { label?: string },
	) {
		return getMacroPreview(macroName);
	}

	protected promptForMathValue(): Promise<string> {
		return Promise.resolve("calculation_result");
	}

	protected promptForVariable(
		variableName: string,
		context?: PromptContext
	): Promise<string> {
		return Promise.resolve(getVariablePromptExample(variableName));
	}

	protected async getTemplateContent(templatePath: string): Promise<string> {
		const app = this.app;
		if (!app) {
			return `Template (app unavailable): ${templatePath}`;
		}

		try {
			return await new SingleTemplateEngine(
				app,
				this.plugin,
				templatePath,
				undefined,
			).run();
		} catch {
			return `Template (not found): ${templatePath}`;
		}
	}

	 
	protected async getSelectedText(): Promise<string> {
		return "selected_text";
	}

	protected async getClipboardContent(): Promise<string> {
		return "clipboard_content";
	}

	protected async suggestForField(variableName: string) {
		return Promise.resolve(`${variableName}_field_value`);
	}

	protected suggestForFile(parsed: ParsedFileToken): string {
		// Preview: show a representative real file, else a placeholder. Never prompt.
		const files = this.app
			? EnhancedFieldSuggestionFileFilter.filterFiles(
					this.app.vault.getMarkdownFiles(),
					parsed.filter,
					(file) => this.app!.metadataCache.getFileCache(file),
				)
			: [];
		if (files.length > 0) return `${FILE_PICK_PREFIX}${files[0].path}`;
		return `${FILE_CUSTOM_PREFIX}${parsed.folderPath || "file"}`;
	}

	protected async replaceDateVariableInString(input: string): Promise<string> {
		let output: string = input;
		
		// For preview, show helpful format examples instead of failing
		output = output.replace(new RegExp(DATE_VARIABLE_REGEX.source, 'gi'), (match, variableName, dateFormat, rawOptions) => {
			const cleanVariableName = variableName?.trim();
			const cleanDateFormat = dateFormat?.trim();
			const { defaultValue: cleanDefaultValue, optional } =
				parseVDateOptions(rawOptions);

			if (!cleanVariableName || !cleanDateFormat) {
				return match; // Return original if incomplete
			}

			// Generate a preview using current date with the specified format
			const previewDate = new Date();
			let formattedExample: string;
			
			try {
				// Try to generate a realistic preview using the format
				formattedExample = DateFormatPreviewGenerator.generate(cleanDateFormat, previewDate);
			} catch {
				// Fallback to showing the format pattern
				formattedExample = `[${cleanDateFormat} format]`;
			}
			
			// If there's a default value, indicate it in the preview
			if (cleanDefaultValue) {
				formattedExample += ` (default: ${cleanDefaultValue})`;
			}
			if (optional) {
				formattedExample += ` (optional)`;
			}

			return formattedExample;
		});
		
		return output;
	}

	protected replaceRandomInString(input: string): string {
		let output = input;
		
		// Replace {{RANDOM:n}} with a preview showing example output
		output = output.replace(/{{RANDOM:(\d+)}}/gi, (match, length) => {
			const len = parseInt(length);
			if (len <= 0 || len > 100) {
				return match; // Return original if invalid
			}
			
			// Generate a preview random string
			const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
			let preview = '';
			for (let i = 0; i < Math.min(len, 8); i++) {
				preview += chars.charAt(Math.floor(Math.random() * chars.length));
			}
			
			// For long strings, show truncated preview
			if (len > 8) {
				preview += `... (${len} chars)`;
			}
			
			return preview;
		});
		
		return output;
	}

	protected isTemplatePropertyTypesEnabled(): boolean {
		return false; // Preview formatter doesn't need structured YAML variable handling
	}
}
