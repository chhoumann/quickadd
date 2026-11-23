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
		// Line-target fields leave {{foldercurrent}} literal at run time
		// (formatLocationString), so their preview must too.
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
		output = await this.replaceGlobalVarInString(output);
		output = unescapePipesInTokens(output);
		// As in CaptureChoiceFormatter, linebreak escapes expand in the format
		// template (including global snippets), never in substituted content.
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
		// Note-derived tokens in one pass, so no token re-scans another's output.
		// {{title}} is never resolved here.
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
		// Where the run has it: after {{FILE:}}, before {{RANDOM:}}.
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
