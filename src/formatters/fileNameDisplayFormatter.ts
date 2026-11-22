import { stripCursorMarkers } from "../utils/capturePlacement";
import { PreviewFormatter } from "./previewFormatter";
import { unescapePipesInTokens } from "../utils/pipeEscapes";
import { findInlineScriptSpans, hasUnterminatedInlineScriptFence } from "../utils/inlineScriptSpans";
import { describePreviewFailure } from "./previewDiagnostics";
import type { App } from "obsidian";
import { TFile, TFolder } from "obsidian";
import { TITLE_REGEX } from "../constants";
import type { IDateParser } from "../parsers/IDateParser";
import { NLDParser } from "../parsers/NLDParser";
import type { RunClocks } from "../types/dateOrigin";
import { getSuggestionPreview, fileNameSafeStandIn } from "./helpers/previewHelpers";
import {
	describeIllegalFilePathChars,
	findIllegalFilePathChars,
	previewGeneratedFilePath,
} from "../utils/generatedFilePath";

import type { FormatterPluginContext } from "../types/pluginContext";

/** Detect an unfinished token with linear scans; preview input may include an entire template. */
function hasUnterminatedToken(input: string): boolean {
	const lastOpen = input.lastIndexOf("{{");
	if (lastOpen === -1) return false;
	return input.indexOf("}}", lastOpen + 2) === -1;
}

/** Exclude script source from filename diagnostics without executing it.
 * Fences introduced by later global expansion are also excluded, although runtime leaves them literal. */
function textOutsideScriptSpans(text: string): string {
	const spans = findInlineScriptSpans(text);
	if (spans.length === 0) return text;

	let output = "";
	let index = 0;
	for (const span of spans) {
		output += text.slice(index, span.start);
		index = span.end;
	}
	return output + text.slice(index);
}

export class FileNameDisplayFormatter extends PreviewFormatter {
	protected readonly showsTokenHints = false;

	constructor(
		app: App,
		protected readonly plugin?: FormatterPluginContext,
		dateParser?: IDateParser,
	) {
		super(app);
		this.dateParser = dateParser || NLDParser;
	}

	/**
	 * The run's calendar origin. Without it a `Daily/{{DATE}}` preview shows
	 * today while the run, aimed at yesterday by Which day, writes another file.
	 */
	public setRunClocks(clocks: RunClocks | undefined): void {
		this.clocks = clocks;
	}

	public async format(input: string): Promise<string> {
		let output: string = input;
		this.beginPreviewPass();

		try {
			output = stripCursorMarkers(await this.formatInternal(input, { included: false }));
		} catch (error) {
			// Return the input as-is if formatting fails during preview. The failure
			// itself is the most useful thing the preview can say, so it goes on the
			// diagnostics channel rather than being swallowed (issue #1558).
			const described = describePreviewFailure(error);
			if (described) this.diagnostics.add("error", described);
			return stripCursorMarkers(input);
		}

		// Before the normalizer, mirroring the run: formatFileName's
		// circular-dependency check runs on the formatted string, and if it fires
		// the choice dies there - no name is ever normalized (#1588).
		this.reportCircularTitle(input, output);

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
			// "path": the format resolved fine, the vault just will not take the
			// result. A host that knows this field may not be a path at all (the
			// capture target) discards exactly these.
			this.diagnostics.add("error", problem, "path");
		}
		// On `output`, not `normalized.path`: the normalizer collapses the line
		// breaks that delimit an inline script fence, and the scan below has to
		// still be able to find one. It costs nothing - the normalizer only trims
		// trailing dots/spaces and collapses control runs, so it can neither add
		// nor remove one of these characters.
		this.reportIllegalChars(input, output);
		return normalized.path;
	}

	/** Mirror runtime title-cycle checks on raw and expanded input.
 * This is a formatting error, not a path error that capture-target previews may discard. */
	private reportCircularTitle(input: string, output: string): void {
		if (!TITLE_REGEX.test(input) && !TITLE_REGEX.test(output)) {
			return;
		}
		this.reportProblem(
			"A file name cannot contain {{title}}, because the title is derived from the file name itself - so this choice would fail at run time.",
		);
	}

	/** Validate the finished name so illegal characters introduced by expansion are included. */
	private reportIllegalChars(input: string, name: string): void {
		// A pass that already failed has said something better. All four of this
		// formatter's `[QuickAdd: ...]` placeholders carry a colon and all four
		// report their real problem first, so without this the row would pile a
		// second, misleading sentence on top of "Template not found".
		if (this.diagnostics.hasError) return;

		// Mid-token. `Notes/{{DATE:` is what the field holds for as long as
		// someone reads the format-suggester popup that this exact prefix opens,
		// and the unmatched token stays literal in the output - so the colon is
		// the caret's position, not a mistake. Costs only a literal `{{` in a
		// name, which no format string has.
		// ...and mid-SCRIPT, for the same reason: until the closing backticks are
		// typed there is no span to strip, so the half-written JavaScript is read
		// as part of the name, and `{a: 1}` or `"HH:mm"` in it turns the row red
		// on every pause.
		if (hasUnterminatedToken(input) || hasUnterminatedInlineScriptFence(input)) {
			return;
		}

		const illegal = findIllegalFilePathChars(textOutsideScriptSpans(name));
		if (illegal.length === 0) return;

		// A file that is already there is never created, so Obsidian is never
		// asked to accept its name. `:` is legal on macOS/Linux at the filesystem
		// level, so a note made outside Obsidian really can carry one - and a
		// capture pointed at it appends happily (CaptureChoiceEngine takes the
		// `fileExists` branch and never reaches `vault.create`), as does a
		// Template choice set to append/increment. Claiming otherwise would mark a
		// working configuration broken.
		if (this.existsInVault(name)) return;

		this.diagnostics.add("error", describeIllegalFilePathChars(illegal), "path");
	}

	/** Recognize existing vault targets before rejecting filename characters; tolerate partially initialized preview apps. */
	private existsInVault(name: string): boolean {
		const vault = this.app?.vault;
		// Defensive because this runs OUTSIDE format()'s try/catch: a preview that
		// throws its way out of a keystroke is the #1558 failure, and this is the
		// only vault call the pass makes.
		if (typeof vault?.getAbstractFileByPath !== "function") return false;
		const trimmed = name.trim();
		if (!trimmed) return false;

		if (trimmed.endsWith("/")) {
			return (
				vault.getAbstractFileByPath(trimmed.slice(0, -1)) instanceof TFolder
			);
		}

		if (vault.getAbstractFileByPath(trimmed) instanceof TFile) return true;
		const withExtension = vault.getAbstractFileByPath(`${trimmed}.md`);
		if (withExtension instanceof TFile) return true;
		// `captureTargetResolution` rule: a bare name that is an existing folder
		// with no real note beside it is a folder SCOPE, and the capture picks a
		// file inside it - nothing asks Obsidian to accept this string as a name.
		return vault.getAbstractFileByPath(trimmed) instanceof TFolder;
	}

	/** Included template bodies use content token semantics. Their title is resolved separately without invented examples. */
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
		output = unescapePipesInTokens(output);
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
		// Where the run has it (CompleteFormatter.format: after {{FILE:}}, before
		// {{RANDOM:}}). The run really does prompt here - formatFileName goes
		// through format() - so leaving {{MVALUE}} literal made the preview
		// promise a name with a token in it (#1587). `promptForMathValue` was
		// already overridden with a stand-in below; it was simply unreachable.
		output = await this.replaceMathValueInString(output);
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

	/**
	 * A prompt header, variable name or macro name is not part of the name at
	 * run time, so a stand-in built from one that could not be part of a file
	 * name shows `neutral` instead of a character the run would never produce.
	 */
	protected standIn(value: string, neutral: string): string {
		return fileNameSafeStandIn(value, neutral);
	}

	protected suggestForValue(
		suggestedValues: string[],
		allowCustomInput = false,
		_context?: { placeholder?: string; variableKey?: string },
	) {
		// The first option, without the body preview's " (N options)" count: the
		// run splices in exactly the option that gets picked, so the count would
		// be text in a file name that no created file can have.
		return suggestedValues[0] ?? getSuggestionPreview(suggestedValues);
	}

	protected async formatIncludedTemplate(body: string, templatePath: string): Promise<string> {
		const resolved = this.resolveTitleInIncludedBody(
			await this.formatInternal(body, { included: true }),
		);
		this.warnIfJoinedIntoOneLine(templatePath, resolved);
		return resolved;
	}

	/** Included bodies use the stored title or empty string, matching runtime without inventing an example title. */
	private resolveTitleInIncludedBody(body: string): string {
		if (!TITLE_REGEX.test(body)) return body;
		const title = this.variables.get("title");
		// A function replacer, not a string: a title containing "$&" would
		// otherwise be spliced through String.replace's substitution syntax.
		const resolved = typeof title === "string" ? title : "";
		return body.replace(new RegExp(TITLE_REGEX.source, "gi"), () => resolved);
	}

	/** Warn when a multi-line include becomes a single-line name; trailing newlines alone are harmless. */
	private warnIfJoinedIntoOneLine(templatePath: string, resolved: string): void {
		const lines = resolved.split(/\r?\n/).filter((line) => line.trim());
		if (lines.length < 2) return;
		this.warn(
			`Template "${templatePath}" is ${lines.length} lines; a file name is one line, so they are joined with spaces.`,
		);
	}
}
