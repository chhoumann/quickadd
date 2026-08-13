import {
	defaultDateVariableFormat,
	Formatter,
	renderStoredDateVariable,
	type PromptContext,
} from "./formatter";
import {
	describePreviewFailure,
	PreviewDiagnostics,
} from "./previewDiagnostics";
import type { App } from "obsidian";
import type QuickAdd from "../main";
import { getTemplateFile } from "../utils/templateFolderUtils";
import { DATE_VARIABLE_REGEX, GLOBAL_VAR_REGEX } from "../constants";
import type { IDateParser } from "../parsers/IDateParser";
import { NLDParser } from "../parsers/NLDParser";
import {
	getVariableExample,
	getMacroPreview,
	getVariablePromptExample,
	getSuggestionPreview,
	fieldValuePreview,
	getCurrentFileLinkPreview,
	getCurrentFileLinkToSectionPreview,
	getCurrentFileNamePreview,
	getCurrentFolderPathPreview,
	DateFormatPreviewGenerator
} from "./helpers/previewHelpers";
import { getValueVariableBaseName } from "../utils/valueSyntax";
import { parseVDateOptionsForPreview } from "../utils/vdateSyntax";
import { snappedExampleDate } from "./helpers/snappedExampleDate";
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
		this.diagnostics = new PreviewDiagnostics();
		try {
			return await this.formatInternal(input, {
				expandLinebreakEscapes: true,
			});
		} catch (error) {
			// Return the input as-is if formatting fails during preview: this
			// prevents crashes when typing incomplete syntax. The failure itself is
			// the most useful thing the preview can say, so it goes on the
			// diagnostics channel rather than being swallowed (issue #1558).
			const described = describePreviewFailure(error);
			if (described) this.diagnostics.add("error", described);
			return input;
		}
	}

	/**
	 * The preview pass list. `expandLinebreakEscapes` is false for an INCLUDED
	 * template body: the runtime treats `\n` as format-template material and never
	 * expands it on substituted content (issue #527), so expanding it here would
	 * corrupt a template containing `\nabla` or `C:\Users\nadia`.
	 */
	private async formatInternal(
		input: string,
		{ expandLinebreakEscapes }: { expandLinebreakEscapes: boolean },
	): Promise<string> {
		let output: string = input;
		// Expand global variables first so previews include their content
		output = await this.replaceGlobalVarInString(output);
		// Mirror CaptureChoiceFormatter: linebreak escapes are format-template
		// material (including global snippets) and expand before token
		// substitution, never on substituted content (issue #527).
		if (expandLinebreakEscapes) {
			output = this.expandLinebreakEscapesOutsideTokens(output);
		}
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
		// Where the run has it (CompleteFormatter.format: after {{FILE:}}, before
		// {{RANDOM:}}). `promptForMathValue` was already overridden below with a
		// stand-in that nothing could reach (#1587).
		output = await this.replaceMathValueInString(output);
		output = this.replaceRandomInString(output);

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

	/**
	 * Previews an included template's body WITHOUT the runtime engine.
	 *
	 * This used to build a `SingleTemplateEngine`, whose base `TemplateEngine`
	 * constructs a real `CompleteFormatter` — so typing `{{TEMPLATE:x.md}}` into a
	 * builder field ran the RUN-TIME formatter over that template on every
	 * keystroke. Verified live on Obsidian 1.13.0: it opened real, blocking input
	 * prompt modals on top of the settings window, fired the run's warning
	 * Notices for tokens inside the template, and reached the macro engine — where
	 * it threw, because the preview passes no choice executor, and the throw was
	 * swallowed into a "Template (not found)" that was simply a lie (issue #1558).
	 *
	 * Resolving the body through THIS formatter keeps the preview inert: the same
	 * substitutions the top level gets, no prompts, no macro engine, no inline JS.
	 */
	protected async getTemplateContent(templatePath: string): Promise<string> {
		const app = this.app;
		if (!app) {
			this.reportProblem(`Template preview unavailable: ${templatePath}`);
			return `[QuickAdd: template preview unavailable] ${templatePath}`;
		}

		const file = getTemplateFile(app, templatePath);
		if (!file) {
			// An error, not a quiet placeholder: the run THROWS here
			// (TemplateEngine.getTemplateContent) and the choice dies, so the row
			// must read "Unresolved:" rather than presenting a preview. The cycle
			// and max-depth branches in replaceTemplateInString already report;
			// not-found was the odd one out.
			this.reportProblem(`Template not found: ${templatePath}`);
			return `[QuickAdd: template not found] ${templatePath}`;
		}

		// The depth counter is preview-LOCAL on purpose. At run time
		// `CompleteFormatter.getTemplateContent` hands the child engine a COPY of
		// the state with depth + 1, while `visited` is shared by reference — so
		// incrementing depth inside the shared `replaceTemplateInString` would
		// advance the runtime by two per level and halve its inclusion limit. The
		// preview has no child formatter to carry it, so it counts here. Preview
		// and runtime both still cap at MAX_TEMPLATE_INCLUSION_DEPTH levels.
		//
		// What the local counter buys: cycle and depth accounting that spans the
		// preview level itself, on one budget shared across the field. Before this
		// change the preview handed the engine no inclusion state at all, so the
		// first nested level always started over from an empty `visited` and depth
		// 0. (It was not unbounded - inside the engine subtree `visited` was shared
		// by reference, so a self-including template still terminated.)
		this.templateInclusion ??= { visited: new Set<string>(), depth: 0 };
		this.templateInclusion.depth++;
		try {
			return await this.formatInternal(await app.vault.cachedRead(file), {
				expandLinebreakEscapes: false,
			});
		} catch (error) {
			// Contained here rather than by format()'s catch, so one bad token
			// inside an included template does not blank the whole field's preview.
			const described = describePreviewFailure(error);
			if (described) this.diagnostics.add("error", described);
			return `[QuickAdd: template preview failed] ${templatePath}`;
		} finally {
			this.templateInclusion.depth--;
		}
	}

	 
	protected async getSelectedText(): Promise<string> {
		return "selected_text";
	}

	protected async getClipboardContent(): Promise<string> {
		return "clipboard_content";
	}

	protected async suggestForField(
		_variableName: string,
		parsed: { fieldName: string },
	) {
		return Promise.resolve(fieldValuePreview(parsed));
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
			const { options, error } = parseVDateOptionsForPreview(rawOptions);
			// Reported, not swallowed: a unit that never resolves aborts the run.
			// The options still come back usable, so the preview TEXT stays stable
			// while the unit is half-typed.
			if (error) this.reportProblem(error);
			const {
				defaultValue: cleanDefaultValue,
				optional,
				withTime,
				snap,
				caseStyle,
			} = options;
			// Only a NAMELESS token stays literal, as the run leaves it. A token
			// that names no FORMAT is complete and working: the run supplies
			// YYYY-MM-DD, or YYYY-MM-DD HH:mm under |time (#1589).
			const cleanDateFormat =
				dateFormat?.trim() || defaultDateVariableFormat(withTime);

			if (!cleanVariableName) {
				return match; // Return original if incomplete
			}

			// An ANSWERED date wins over the example, resolved through the run's
			// own renderer so a seeded @date:ISO renders exactly as it will.
			const stored = renderStoredDateVariable(
				this.variables.get(cleanVariableName),
				cleanDateFormat,
				snap,
				this.dateParser,
			);
			if (stored) return this.applyCaseOption(stored.text, caseStyle, match);

			// Generate a preview using current date with the specified format,
			// snapped the way the run snaps it - matching both the ANSWERED branch
			// above and {{DATE:...|startof:}}, which has always snapped in this
			// same pass. Inside the try: the snap needs moment.
			let formattedExample: string;

			try {
				// Try to generate a realistic preview using the format
				formattedExample = this.applyCaseOption(
					DateFormatPreviewGenerator.generate(
						cleanDateFormat,
						snappedExampleDate(snap),
					),
					caseStyle,
					match,
				);
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
