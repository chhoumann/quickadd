import { stripCursorMarkers } from "../utils/capturePlacement";
import { PreviewFormatter } from "./previewFormatter";
import { unescapePipesInTokens } from "../utils/pipeEscapes";
import { describePreviewFailure } from "./previewDiagnostics";
import type { App } from "obsidian";
import type { FormatterPluginContext } from "../types/pluginContext";
import type { IDateParser } from "../parsers/IDateParser";
import { NLDParser } from "../parsers/NLDParser";
import { getSuggestionPreview } from "./helpers/previewHelpers";

export class FormatDisplayFormatter extends PreviewFormatter {
	protected readonly showsTokenHints = true;

	constructor(
		app: App,
		protected readonly plugin: FormatterPluginContext,
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
		this.beginPreviewPass();
		try {
			return stripCursorMarkers(await this.formatInternal(input, {
				expandLinebreakEscapes: true,
			}));
		} catch (error) {
			// Return the input as-is if formatting fails during preview: this
			// prevents crashes when typing incomplete syntax. The failure itself is
			// the most useful thing the preview can say, so it goes on the
			// diagnostics channel rather than being swallowed (issue #1558).
			const described = describePreviewFailure(error);
			if (described) this.diagnostics.add("error", described);
			return stripCursorMarkers(input);
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
		output = unescapePipesInTokens(output);
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
		output = await this.replaceTemplateOutsideScripts(output);
		output = await this.replaceFieldVarInString(output);
		output = await this.replaceFileInString(output);
		// Where the run has it (CompleteFormatter.format: after {{FILE:}}, before
		// {{RANDOM:}}). `promptForMathValue` was already overridden below with a
		// stand-in that nothing could reach (#1587).
		output = await this.replaceMathValueInString(output);
		output = this.replaceRandomInString(output);

		return output;
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

	protected suggestForValueMulti(
		suggestedValues: string[],
		_allowCustomInput?: boolean,
		context?: { displayValues?: string[] },
	): string[] {
		return [getSuggestionPreview(context?.displayValues ?? suggestedValues)];
	}

	protected async formatIncludedTemplate(body: string): Promise<string> {
		return this.formatInternal(body, { expandLinebreakEscapes: false });
	}
}
