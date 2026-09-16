import { PreviewFormatter } from "./previewFormatter";
import { expandGlobalVariables } from "./helpers/globalVariables";
import { defaultDateVariableFormat, renderStoredDateVariable, type PromptContext } from "./formatter";
import {
	describePreviewFailure,
	PreviewDiagnostics,
} from "./previewDiagnostics";
import type { App } from "obsidian";
import type QuickAdd from "../main";
import { getTemplateFile } from "../utils/templateFolderUtils";
import { DATE_VARIABLE_REGEX } from "../constants";
import type { IDateParser } from "../parsers/IDateParser";
import { NLDParser } from "../parsers/NLDParser";
import { getVariableExample, getMacroPreview, getVariablePromptExample, getSuggestionPreview, fieldValuePreview, getCurrentFileLinkToSectionPreview, DateFormatPreviewGenerator } from "./helpers/previewHelpers";
import { getValueVariableBaseName } from "../utils/valueSyntax";
import { parseVDateOptionsForPreview } from "../utils/vdateSyntax";
import { snappedExampleDate } from "./helpers/snappedExampleDate";

export class FormatDisplayFormatter extends PreviewFormatter {
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

	/** Included template bodies use content token semantics. Their title is resolved separately without invented examples. */
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
		return expandGlobalVariables(input, this.plugin?.settings?.globalVariables);
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

	protected getCurrentFileLinkToSection(): string | null {
		if (!this.app) return getCurrentFileLinkToSectionPreview(null);
		return getCurrentFileLinkToSectionPreview(
			this.app.workspace.getActiveFile(),
		);
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

	protected promptForVariable(
		variableName: string,
		context?: PromptContext
	): Promise<string> {
		return Promise.resolve(getVariablePromptExample(variableName));
	}

	/** Resolve included bodies through this preview, never a runtime engine that could execute scripts or prompt. */
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

	protected async suggestForField(
		_variableName: string,
		parsed: { fieldName: string },
	) {
		return Promise.resolve(fieldValuePreview(parsed));
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
}
