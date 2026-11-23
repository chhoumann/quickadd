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

/** Excludes script source from filename diagnostics without executing it. */
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
			const described = describePreviewFailure(error);
			if (described) this.diagnostics.add("error", described);
			return stripCursorMarkers(input);
		}

		// Before the normalizer, as at run time: the title-cycle check fires on the
		// formatted string before any name is normalized.
		this.reportCircularTitle(input, output);

		// Every generated name goes through this normalizer at run time, so the
		// preview must too. Non-throwing: incomplete input on each keystroke becomes
		// diagnostics instead of aborts.
		const normalized = previewGeneratedFilePath(output);
		for (const problem of normalized.problems) {
			this.diagnostics.add("error", problem, "path");
		}
		// On `output`: the normalizer collapses the line breaks that delimit an
		// inline script fence, and cannot add or remove an illegal character.
		this.reportIllegalChars(input, output);
		return normalized.path;
	}

	/** A title cycle is a formatting error, not a path error that capture-target previews may discard. */
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
		// A pass that already failed said something better, and every
		// `[QuickAdd: ...]` placeholder contains a colon.
		if (this.diagnostics.hasError) return;

		// Mid-token or mid-script: until the closing `}}` or backticks are typed,
		// a colon marks the caret, not a mistake.
		if (hasUnterminatedToken(input) || hasUnterminatedInlineScriptFence(input)) {
			return;
		}

		const illegal = findIllegalFilePathChars(textOutsideScriptSpans(name));
		if (illegal.length === 0) return;

		// An existing file is never created, so Obsidian never judges its name.
		// `:` is legal on macOS/Linux, and captures into such a note work.
		if (this.existsInVault(name)) return;

		this.diagnostics.add("error", describeIllegalFilePathChars(illegal), "path");
	}

	/** Recognize existing vault targets before rejecting filename characters; tolerate partially initialized preview apps. */
	private existsInVault(name: string): boolean {
		const vault = this.app?.vault;
		// Runs outside format()'s try/catch, and a preview must never throw out of
		// a keystroke.
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

		// {{TEMPLATE:}} first, as at run time, so a body is never spliced in for a
		// token that a global snippet or value produced.
		output = await this.replaceTemplateOutsideScripts(output);
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
		// Where the run has it: after {{FILE:}}, before {{RANDOM:}}. formatFileName
		// really prompts here.
		output = await this.replaceMathValueInString(output);
		// Note-derived tokens in one pass, so no token re-scans another's output.
		// Preview resolvers never return null, so the missing-active-file throw
		// cannot fire.
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
