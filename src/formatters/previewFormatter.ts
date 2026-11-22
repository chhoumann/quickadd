import { Formatter, type PromptContext } from "./formatter";
import { PreviewDiagnostics } from "./previewDiagnostics";
import { DateFormatPreviewGenerator, fieldValuePreview, getCurrentFileLinkPreview, getCurrentFileLinkToSectionPreview, getCurrentFileNamePreview, getCurrentFolderPathPreview, getMacroPreview, getVariableExample, getVariablePromptExample } from "./helpers/previewHelpers";
import { findDateVariableFormat, rememberDateVariableFormat, renderStoredDateVariable } from "./helpers/dateTokens";
import { defaultDateVariableFormat } from "../utils/dateTokenCodec";
import { applyDateSnap, type DateSnap } from "../utils/dateModifiers";
import { getFileTokenFiles } from "../utils/vaultQueries";
import { FILE_CUSTOM_PREFIX, FILE_PICK_PREFIX, type ParsedFileToken } from "../utils/fileSyntax";
import type { ParsedVDateOptions } from "../utils/vdateSyntax";
import { getValueVariableBaseName } from "../utils/valueSyntax";
import { findInlineScriptSpans } from "../utils/inlineScriptSpans";
import { getTemplateFile } from "../utils/templateFolderUtils";
import { parseVDateOptionsForPreview } from "../utils/vdateSyntax";
import { DATE_VARIABLE_REGEX, RANDOM_REGEX } from "../constants";
import { describePreviewFailure } from "./previewDiagnostics";

/**
 * Today, snapped as `|startof:`/`|endof:` will snap it at run time, for the
 * example an unanswered `{{VDATE:}}` preview shows. Both preview rows use it, so
 * the example agrees with the answered branch and with `{{DATE:...|startof:}}`.
 * Without a snap it never touches Obsidian's `window.moment`.
 */
function snappedExampleDate(snap: DateSnap | undefined): Date {
	const now = new Date();
	if (!snap) return now;
	return applyDateSnap(window.moment(now), snap).toDate();
}

/**
 * Includes one preview pass may expand, across the whole format string.
 * Generous next to any real naming template (which includes one file, or none),
 * and small enough that a pathological include tree cannot stall a keystroke.
 */
const MAX_PREVIEW_TEMPLATE_INCLUDES = 25;

/** Shared inert resolvers. Concrete previews retain their own pass order. */
export abstract class PreviewFormatter extends Formatter {
	public diagnostics = new PreviewDiagnostics();

	/**
	 * Whether a token's preview may carry hints about its prompt, such as
	 * " (default: X)". A file name may not: the run splices in the value and
	 * nothing else.
	 */
	protected abstract readonly showsTokenHints: boolean;

	/** Includes this pass may still expand. See {@link getTemplateContent}. */
	private templateIncludeBudget = MAX_PREVIEW_TEMPLATE_INCLUDES;

	/** Answers the run already has, so the preview shows what it will write. */
	public seedAnswers(values: Readonly<Record<string, unknown>>): void {
		for (const [key, value] of Object.entries(values)) this.variables.set(key, value);
	}

	/** Starts a preview pass: fresh diagnostics and a full include budget. */
	protected beginPreviewPass(): void {
		this.diagnostics = new PreviewDiagnostics();
		this.templateIncludeBudget = MAX_PREVIEW_TEMPLATE_INCLUDES;
	}

	/** Formats an included template's body the way this preview formats its own text. */
	protected abstract formatIncludedTemplate(body: string, templatePath: string): Promise<string>;

	/** Skip script fences during inclusion: runtime consumes scripts first, while previews must remain inert. */
	protected async replaceTemplateOutsideScripts(input: string): Promise<string> {
		const spans = findInlineScriptSpans(input);
		if (spans.length === 0) return this.replaceTemplateInString(input);

		let output = "";
		let index = 0;
		for (const span of spans) {
			output += await this.replaceTemplateInString(input.slice(index, span.start));
			output += input.slice(span.start, span.end);
			index = span.end;
		}
		return output + (await this.replaceTemplateInString(input.slice(index)));
	}

	/** Resolve included bodies through this preview, never a runtime engine that could execute scripts or prompt. */
	protected async getTemplateContent(templatePath: string): Promise<string> {
		const app = this.app;
		if (!app) {
			this.reportProblem(`Template preview unavailable: ${templatePath}`);
			return `[QuickAdd: template preview unavailable] ${templatePath}`;
		}

		// Depth and cycle detection (in the shared `replaceTemplateInString`) both
		// unwind per include, so neither bounds a format string that keeps
		// producing NEW includes - a global snippet holding a {{TEMPLATE:}} token
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
			// must read "Unresolved:" rather than presenting a preview.
			this.reportProblem(`Template not found: ${templatePath}`);
			return `[QuickAdd: template not found] ${templatePath}`;
		}

		this.templateIncludeBudget--;
		// Depth is counted here, preview-local: at run time the child engine gets a
		// copy with depth + 1 while `visited` is shared, so counting in the shared
		// replaceTemplateInString would halve the runtime limit.
		this.templateInclusion ??= { visited: new Set<string>(), depth: 0 };
		this.templateInclusion.depth++;
		try {
			return await this.formatIncludedTemplate(await app.vault.cachedRead(file), templatePath);
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
	 * A named {{VDATE}} as its date. Only a NAMELESS token stays literal, which
	 * is what the run does with it, so its options are not read either.
	 */
	protected async replaceDateVariableInString(input: string): Promise<string> {
		return input.replace(new RegExp(DATE_VARIABLE_REGEX.source, "gi"), (match, variableName, dateFormat, rawOptions) => {
			const name = variableName?.trim();
			if (!name) return match;

			// A unit that never resolves is an authoring mistake the run aborts on,
			// so it belongs on the diagnostics channel rather than being swallowed.
			// The options still come back usable, so the text does not flicker
			// while the unit is being typed.
			const { options, error } = parseVDateOptionsForPreview(rawOptions);
			if (error) this.reportProblem(error);

			const date = this.previewDateVariable(match, name, dateFormat, options);
			if (date.answered || !this.showsTokenHints) return date.text ?? `[${date.format}]`;

			// Hints about the prompt belong on the example, not on an answer.
			let preview = date.text ?? `[${date.format} format]`;
			if (options.defaultValue) preview += ` (default: ${options.defaultValue})`;
			if (options.optional) preview += ` (optional)`;
			return preview;
		});
	}

	/** {{RANDOM:n}} as a stable example, so the preview does not change on every keystroke. */
	protected replaceRandomInString(input: string): string {
		return input.replace(new RegExp(RANDOM_REGEX.source, "gi"), (match, length: string) => {
			const len = parseInt(length);
			if (len <= 0 || len > 100) return match;

			const example = "ABC123".slice(0, Math.min(len, 6));
			if (len <= 6) return example;
			return this.showsTokenHints ? `${example}... (${len} chars)` : `${example}...`;
		});
	}

	protected warn(message: string): void {
		this.diagnostics.add("warning", message);
	}

	protected reportProblem(message: string): void {
		this.diagnostics.add("error", message);
	}

	/**
	 * The text shown for a prompt the preview never opens. The file-name
	 * preview swaps one that could not be part of a file name for `neutral`.
	 */
	protected standIn(value: string, _neutral: string): string {
		return value;
	}

	protected promptForValue(header?: string): string {
		return this.standIn(
			header || this.valuePromptContext?.label || "user input",
			"user input",
		);
	}

	protected getVariableValue(variableName: string): string {
		const stored = this.variables.get(variableName);
		if (typeof stored === "string") return stored;
		const baseName = getValueVariableBaseName(variableName);
		return this.standIn(getVariableExample(baseName), "user input");
	}

	protected async promptForVariable(
		variableName: string,
		context?: PromptContext,
	): Promise<string> {
		// A {{VALUE:<name>}} reuse of an unanswered {{VDATE:<name>,...}} shows
		// the VDATE's example date, as the run prints the one answer.
		const dateFormat = findDateVariableFormat(
			this.variables,
			context?.variableKey ?? variableName,
		);
		if (dateFormat) return DateFormatPreviewGenerator.generate(dateFormat);
		return this.standIn(getVariablePromptExample(variableName), "user input");
	}

	protected getMacroValue(macroName: string, _context?: { label?: string }) {
		return this.standIn(getMacroPreview(macroName), "macro_output");
	}

	protected async suggestForField(
		_variableName: string,
		parsed: { fieldName: string },
	): Promise<string> {
		return this.standIn(fieldValuePreview(parsed), "field_value");
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

	/**
	 * A named {{VDATE}} as the run renders it, with the run's default format when
	 * none is named. An answered date wins, through the run's own renderer;
	 * otherwise the example is today, snapped and cased like the run. `text` is
	 * undefined when the example cannot be rendered (the snap needs moment).
	 */
	protected previewDateVariable(
		token: string,
		variableName: string,
		dateFormat: string | undefined,
		options: ParsedVDateOptions,
	):
		| { format: string; text: string; answered: true }
		| { format: string; text?: string; answered: false } {
		const { withTime, snap, caseStyle } = options;
		const format = dateFormat?.trim() || defaultDateVariableFormat(withTime);
		rememberDateVariableFormat(this.variables, variableName, format);

		const stored = renderStoredDateVariable(
			this.variables.get(variableName),
			format,
			snap,
			this.dateParser,
		);
		if (stored) {
			return {
				format,
				text: this.applyCaseOption(stored.text, caseStyle, token),
				answered: true,
			};
		}

		try {
			const example = DateFormatPreviewGenerator.generate(
				format,
				snappedExampleDate(snap),
			);
			return {
				format,
				text: this.applyCaseOption(example, caseStyle, token),
				answered: false,
			};
		} catch {
			return { format, answered: false };
		}
	}

	protected promptForMathValue(): Promise<string> {
		return Promise.resolve("calculation_result");
	}

	protected async getSelectedText(): Promise<string> {
		return "selected_text";
	}

	protected async getClipboardContent(): Promise<string> {
		return "clipboard_content";
	}

	protected suggestForFile(parsed: ParsedFileToken): string {
		// Preview: show a representative real file, else a placeholder. Never prompt.
		const files = this.app ? getFileTokenFiles(this.app, parsed) : [];
		if (files.length > 0) return `${FILE_PICK_PREFIX}${files[0].path}`;
		return `${FILE_CUSTOM_PREFIX}${parsed.folderPath || "file"}`;
	}

	protected isTemplatePropertyTypesEnabled(): boolean {
		return false;
	}
}
