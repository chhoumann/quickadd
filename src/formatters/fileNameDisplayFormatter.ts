import { Formatter, type PromptContext } from "./formatter";
import {
	describePreviewFailure,
	PreviewDiagnostics,
} from "./previewDiagnostics";
import type { App } from "obsidian";
import { DATE_VARIABLE_REGEX, GLOBAL_VAR_REGEX } from "../constants";
import type { IDateParser } from "../parsers/IDateParser";
import { NLDParser } from "../parsers/NLDParser";
import {
	getVariableExample,
	getMacroPreview,
	getVariablePromptExample,
	getSuggestionPreview,
	getCurrentFileLinkPreview,
	getCurrentFileNamePreview,
	getCurrentFolderPathPreview,
	DateFormatPreviewGenerator
} from "./helpers/previewHelpers";
import { previewGeneratedFilePath } from "../utils/generatedFilePath";
import { getValueVariableBaseName } from "../utils/valueSyntax";
import { parseVDateOptions } from "../utils/vdateSyntax";
import { EnhancedFieldSuggestionFileFilter } from "../utils/EnhancedFieldSuggestionFileFilter";
import { FILE_CUSTOM_PREFIX, FILE_PICK_PREFIX, type ParsedFileToken } from "../utils/fileSyntax";

import type QuickAdd from "../main";

export class FileNameDisplayFormatter extends Formatter {
	constructor(
		app: App,
		private readonly plugin?: QuickAdd,
		dateParser?: IDateParser,
	) {
		super(app);
		this.dateParser = dateParser || NLDParser;
	}

	/**
	 * Problems this pass ran into, for passive display beside the preview.
	 *
	 * A preview is a speculative evaluation of INCOMPLETE input, re-run on every
	 * keystroke, so it must not have the run's side effects: while you type
	 * `pascal` into `{{VALUE:title|case:}}` every prefix is a complete, invalid
	 * token, and the inherited `log.logWarning` stacked one Obsidian Notice per
	 * character (issue #1558). The real run still warns; this collects.
	 *
	 * Replaced at the start of every `format()` so a pass never inherits the
	 * previous one's complaints.
	 */
	public diagnostics = new PreviewDiagnostics();

	protected warn(message: string): void {
		this.diagnostics.add("warning", message);
	}

	protected reportProblem(message: string): void {
		this.diagnostics.add("error", message);
	}

	public async format(input: string): Promise<string> {
		let output: string = input;
		this.diagnostics = new PreviewDiagnostics();

		try {
			// Expand globals first to preview inserted snippets
			output = await this.replaceGlobalVarInString(output);
			output = await this.replaceMacrosInString(output);
			output = this.replaceDateInString(output);
			output = this.replaceTimeInString(output);
			output = await this.replaceValueInString(output);
			output = await this.replaceSelectedInString(output);
			output = await this.replaceClipboardInString(output);
			output = await this.replaceDateVariableInString(output);
			output = await this.replaceVariableInString(output);
			output = await this.replaceFieldVarInString(output);
			output = await this.replaceFileInString(output);
			// {{filenamecurrent}} + {{folder}} + {{foldercurrent}} in one pass so no
			// token re-scans another's output (#1358). The preview resolver below
			// never returns null, so "path" mode cannot throw here.
			output = this.replaceCurrentFileTokensInString(output, {
				fileName: true,
				folder: true,
				activeFolder: "path",
			});
			output = this.replaceRandomInString(output);
		} catch (error) {
			// Return the input as-is if formatting fails during preview. The failure
			// itself is the most useful thing the preview can say, so it goes on the
			// diagnostics channel rather than being swallowed (issue #1558).
			const described = describePreviewFailure(error);
			if (described) this.diagnostics.add("error", described);
			return input;
		}

		// The run puts every generated name through this normalizer on the way to
		// the vault (TemplateChoiceEngine, TemplateInsertEngine,
		// templateNoteDiscovery, and the capture target via
		// captureTargetResolution), so a preview that skips it asserts a name the
		// run will never create: a trailing "." or space is stripped, a backslash is
		// a path separator, and a run of line breaks - the shape a {{TEMPLATE:}}
		// body arrives in - collapses to one space (#1563). Non-throwing here: a
		// preview evaluates incomplete input on every keystroke, so the rejections
		// the run would abort on become diagnostics instead.
		const normalized = previewGeneratedFilePath(output);
		for (const problem of normalized.problems) {
			this.diagnostics.add("error", problem);
		}
		return normalized.path;
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
		_context?: { placeholder?: string; variableKey?: string },
	) {
		return getSuggestionPreview(suggestedValues);
	}

	protected promptForMathValue(): Promise<string> {
		return Promise.resolve("calculation_result");
	}

	protected getMacroValue(
		macroName: string,
		_context?: { label?: string },
	) {
		return getMacroPreview(macroName);
	}

	protected async promptForVariable(
		variableName: string,
		context?: PromptContext
	): Promise<string> {
		return getVariablePromptExample(variableName);
	}

	/**
	 * Unreachable today: this formatter's pass list (see `format()`) never calls
	 * `replaceTemplateInString`, so `{{TEMPLATE:}}` stays literal in a file-name
	 * preview. `getTemplateContent` is abstract on `Formatter`, so the override has
	 * to exist.
	 *
	 * It used to return a fabricated `[<name> template content...]`, which would
	 * have spliced text that READS like a real part of the file name the moment
	 * anyone wired the pass up. It now names what actually happened. Run-time
	 * `formatFileName` does resolve the include (`format()` ->
	 * `replaceTemplateInString`); closing that gap needs a real inert reader, not
	 * a stub.
	 */
	protected async getTemplateContent(templatePath: string): Promise<string> {
		return `[QuickAdd: template not resolved in a file name] ${templatePath}`;
	}

	protected async getSelectedText(): Promise<string> {
		return "selected_text";
	}

	protected async getClipboardContent(): Promise<string> {
		return "clipboard_content";
	}

	protected async suggestForField(variableName: string): Promise<string> {
		return `${variableName}_field_value`;
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

		// Mirror FormatDisplayFormatter's VDATE preview so the file-name preview
		// shows the same default/optional hints (issue #511). Like the body
		// preview, this renders the current date WITHOUT applying |startof:/
		// |endof: snap — snap is only resolved in the real CompleteFormatter
		// pass, and snapping only the file-name preview would diverge from the
		// body preview.
		output = output.replace(new RegExp(DATE_VARIABLE_REGEX.source, 'gi'), (match, variableName, dateFormat, rawOptions) => {
			const cleanVariableName = variableName?.trim();
			const cleanDateFormat = dateFormat?.trim();
			// Parse defensively: a malformed |startof:/|endof: option can throw, and
			// since format() catches and returns the whole raw input on any error, an
			// unparseable VDATE option would otherwise blank out EVERY other preview
			// substitution. Treat a parse failure as "no options".
			let cleanDefaultValue: string | undefined;
			let optional = false;
			try {
				({ defaultValue: cleanDefaultValue, optional } =
					parseVDateOptions(rawOptions));
			} catch {
				cleanDefaultValue = undefined;
				optional = false;
			}

			if (!cleanVariableName || !cleanDateFormat) {
				return match; // Return original if incomplete
			}

			// Generate a realistic preview using the current date.
			const previewDate = new Date();
			let formattedExample: string;

			try {
				formattedExample = DateFormatPreviewGenerator.generate(cleanDateFormat, previewDate);
			} catch {
				formattedExample = `[${cleanDateFormat}]`;
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
			
			// For filename preview, show a simple example
			const exampleChars = 'ABC123';
			let preview = '';
			for (let i = 0; i < Math.min(len, 6); i++) {
				preview += exampleChars.charAt(i % exampleChars.length);
			}
			
			// For long strings, show ellipsis
			if (len > 6) {
				preview += '...';
			}
			
			return preview;
		});
		
		return output;
	}

	protected isTemplatePropertyTypesEnabled(): boolean {
		return false; // Not applicable for filename display
	}
}
