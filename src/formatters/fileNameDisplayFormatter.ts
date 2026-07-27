import {
	findInlineScriptSpans,
	Formatter,
	type PromptContext,
} from "./formatter";
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
	getCurrentFileLinkToSectionPreview,
	getCurrentFileNamePreview,
	getCurrentFolderPathPreview,
	DateFormatPreviewGenerator
} from "./helpers/previewHelpers";
import { previewGeneratedFilePath } from "../utils/generatedFilePath";
import { getTemplateFile } from "../utils/templateFolderUtils";
import { getValueVariableBaseName } from "../utils/valueSyntax";
import { parseVDateOptions } from "../utils/vdateSyntax";
import { EnhancedFieldSuggestionFileFilter } from "../utils/EnhancedFieldSuggestionFileFilter";
import { FILE_CUSTOM_PREFIX, FILE_PICK_PREFIX, type ParsedFileToken } from "../utils/fileSyntax";

import type QuickAdd from "../main";

/**
 * Includes one preview pass may expand, across the whole format string.
 * Generous next to any real naming template (which includes one file, or none),
 * and small enough that a pathological include tree cannot stall a keystroke.
 */
const MAX_PREVIEW_TEMPLATE_INCLUDES = 25;

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

	/**
	 * Includes this pass may still expand. See {@link getTemplateContent}.
	 */
	private templateIncludeBudget = MAX_PREVIEW_TEMPLATE_INCLUDES;

	public async format(input: string): Promise<string> {
		let output: string = input;
		this.diagnostics = new PreviewDiagnostics();
		this.templateIncludeBudget = MAX_PREVIEW_TEMPLATE_INCLUDES;

		try {
			output = await this.formatInternal(input, { included: false });
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

	/**
	 * The preview pass list.
	 *
	 * `included` marks a `{{TEMPLATE:}}` body being resolved for splicing into
	 * the name. At run time that body goes through a child engine's
	 * `formatFileContent` (SingleTemplateEngine.run), which resolves the
	 * note-derived tokens with CONTENT semantics - so an included body previewed
	 * with the file-name pass list would leave literal exactly the tokens people
	 * put in templates ({{linkcurrent}}, {{linksection}}). `{{title}}` stays out
	 * of both: the run resolves it to the empty string here (the title is derived
	 * from the name being built, so it is not known yet), and neither a blank nor
	 * this formatter's example title is a preview worth showing.
	 */
	private async formatInternal(
		input: string,
		{ included }: { included: boolean },
	): Promise<string> {
		let output = input;

		// {{TEMPLATE:}} FIRST, mirroring the run (CompleteFormatter.format resolves
		// includes before globals and before {{VALUE}}). Resolving it later would
		// make the preview splice in a body for a token that a global snippet or a
		// value produced - which the run leaves literal, because its template pass
		// has already gone by. (The globals/macros order below is older than this
		// and is left as it was.)
		output = await this.replaceTemplateOutsideScripts(output);
		// Expand globals to preview inserted snippets
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
		// Note-derived tokens in ONE pass so no token re-scans another's output
		// (#1358). Every preview resolver returns a placeholder rather than null,
		// so neither mode can hit the runtime's missing-active-file throw.
		output = this.replaceCurrentFileTokensInString(
			output,
			included
				? { links: true, fileName: true, folder: true, activeFolder: "content" }
				: { fileName: true, folder: true, activeFolder: "path" },
		);
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
	 * The template pass, skipping inline script fences.
	 *
	 * A fence is verbatim JavaScript source, and the run consumes it BEFORE its
	 * template pass (`replaceInlineJavascriptInString` is the run's first pass), so
	 * a `"{{TEMPLATE:N.md}}"` written as a string literal inside a script is never
	 * an include at run time. The preview has no inline-JS pass at all - by design,
	 * it must not execute anything - so without this it would read that path,
	 * splice the body into the middle of the displayed source, and report a
	 * "Template not found" ERROR for a format that is fine.
	 *
	 * Same protection, same helper, and the same reason as
	 * `expandLinebreakEscapesOutsideTokens` (#1467).
	 */
	private async replaceTemplateOutsideScripts(input: string): Promise<string> {
		const spans = findInlineScriptSpans(input);
		if (spans.length === 0) return this.replaceTemplateInString(input);

		let output = "";
		let index = 0;
		for (const span of spans) {
			output += await this.replaceTemplateInString(
				input.slice(index, span.start),
			);
			output += input.slice(span.start, span.end);
			index = span.end;
		}
		return output + (await this.replaceTemplateInString(input.slice(index)));
	}

	/**
	 * Previews an included template's body WITHOUT the runtime engine (#1563).
	 *
	 * `formatFileName` really does resolve `{{TEMPLATE:}}` - `format()` runs
	 * `replaceTemplateInString`, and path prompt scope is deliberately propagated
	 * into the child engine - so leaving the token literal made the preview say
	 * `{{TEMPLATE:Naming.md}}-My Note` while the run produced whatever Naming.md
	 * rendered to. The one-page input form contradicted itself even harder: its
	 * preflight scans INTO the include for that same field, so it would prompt
	 * for a variable it could only have found inside the template, and then
	 * preview the unresolved token beside the answer.
	 *
	 * Reading it through THIS formatter is what keeps the preview inert: the same
	 * substitutions the top level gets, no prompts, no macro engine, no inline JS
	 * (issue #1558). Building a `SingleTemplateEngine` here would construct a real
	 * `CompleteFormatter` and open blocking modals on every keystroke, which is
	 * the bug #1560 fixed on the content field.
	 */
	protected async getTemplateContent(templatePath: string): Promise<string> {
		const app = this.app;
		if (!app) {
			this.reportProblem(`Template preview unavailable: ${templatePath}`);
			return `[QuickAdd: template preview unavailable] ${templatePath}`;
		}

		// Depth and cycle detection (in the shared `replaceTemplateInString`) both
		// unwind per include, so neither bounds a format string that keeps
		// producing NEW includes - and it can, now that the template pass runs
		// before global expansion: a global snippet holding a {{TEMPLATE:}} token
		// re-arms the loop with an empty `visited` set. One budget for the whole
		// pass terminates that, and bounds the fan-out of a wide include tree on a
		// field that resolves on every keystroke.
		if (this.templateIncludeBudget <= 0) {
			const placeholder = `[QuickAdd: too many template includes to preview]`;
			this.reportProblem(placeholder);
			return placeholder;
		}

		const file = getTemplateFile(app, templatePath);
		if (!file) {
			// An error, not a quiet placeholder: the run THROWS here
			// (TemplateEngine.getTemplateContent) and the choice dies, so the row
			// must read "Unresolved:" rather than presenting a name.
			this.reportProblem(`Template not found: ${templatePath}`);
			return `[QuickAdd: template not found] ${templatePath}`;
		}

		this.templateIncludeBudget--;
		// The depth counter is preview-LOCAL on purpose. At run time
		// `CompleteFormatter.getTemplateContent` hands the child engine a COPY of
		// the state with depth + 1, while `visited` is shared by reference - so
		// incrementing depth inside the shared `replaceTemplateInString` would
		// advance the runtime by two per level and halve its inclusion limit. The
		// preview has no child formatter to carry it, so it counts here.
		this.templateInclusion ??= { visited: new Set<string>(), depth: 0 };
		this.templateInclusion.depth++;
		try {
			const body = await app.vault.cachedRead(file);
			const resolved = await this.formatInternal(body, { included: true });
			this.warnIfJoinedIntoOneLine(templatePath, resolved);
			return resolved;
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

	/**
	 * A template body is many lines and a file name is one, so the normalizer at
	 * the end of `format()` joins them with spaces - which is what the run does
	 * too, and is therefore the honest preview. But a name assembled out of
	 * someone's whole note template reads as a puzzle, and the preview is the only
	 * thing here that knows those were separate lines.
	 *
	 * Deliberately NOT fired for a body that merely ends in a newline: every
	 * well-formed one-line naming template does, and warning about those would be
	 * the per-keystroke noise #1558 removed.
	 */
	private warnIfJoinedIntoOneLine(templatePath: string, resolved: string): void {
		const lines = resolved.split(/\r?\n/).filter((line) => line.trim());
		if (lines.length < 2) return;
		this.warn(
			`Template "${templatePath}" is ${lines.length} lines; a file name is one line, so they are joined with spaces.`,
		);
	}

	protected getCurrentFileLinkToSection(): string | null {
		// Only reachable for an INCLUDED body (the file-name pass leaves links
		// literal, as the run does). Mirrors FormatDisplayFormatter's static
		// example so the two previews describe the token the same way.
		if (!this.app) return getCurrentFileLinkToSectionPreview(null);
		return getCurrentFileLinkToSectionPreview(
			this.app.workspace.getActiveFile(),
		);
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
