import { ValueFormatter } from "./valueFormatter";
import { replaceDateInString, replaceTimeInString, replaceDateVariableInString } from "./helpers/dateTokens";
export { defaultDateVariableFormat, renderStoredDateVariable } from "./helpers/dateTokens";
import { findInlineScriptSpans } from "./helpers/inlineScriptSpans";
import { replaceCurrentFileTokens, type CurrentFileTokenOptions } from "./helpers/currentFileTokens";
import { TFile } from "obsidian";
import { LINK_TO_CURRENT_FILE_REGEX, LINK_TO_CURRENT_SECTION_REGEX, FILE_REGEX, MACRO_REGEX, MATH_VALUE_REGEX, TEMPLATE_REGEX, FIELD_VAR_REGEX_WITH_FILTERS, FIELD_VARIABLE_PREFIX, SELECTED_REGEX, CLIPBOARD_REGEX, RANDOM_REGEX, PROPERTY_REGEX } from "../constants";
import {
	decodeFileValue,
	fileBasenameFromPath,
	type ParsedFileToken,
	parseFileToken,
} from "../utils/fileSyntax";
import { renderStoredFileValue } from "./helpers/fileTokenRendering";
import type { RunClocks } from "../types/dateOrigin";
import type { IDateParser } from "../parsers/IDateParser";
import { log } from "../logger/logManager";
import { escapeValueInsideQuotedYamlScalar } from "../utils/yamlScalarQuoting";
import { FieldSuggestionParser } from "../utils/FieldSuggestionParser";
import { parseMacroToken } from "../utils/macroSyntax";
import { stringifyPropertyTokenValue } from "../engine/captureProperty";

export type LinkToCurrentFileBehavior = "required" | "optional";
export { type PromptContext } from "./valueFormatter";

export interface TemplateInclusionState {
	visited: Set<string>;
	depth: number;
}

export const MAX_TEMPLATE_INCLUSION_DEPTH = 10;

export { findInlineScriptSpans, hasUnterminatedInlineScriptFence } from "./helpers/inlineScriptSpans";

export abstract class Formatter extends ValueFormatter {
	protected dateParser: IDateParser | undefined;
	private linkToCurrentFileBehavior: LinkToCurrentFileBehavior = "required";
	// The folder the note is being created in, supplied by the engine before
	// formatting a file name / body. `null` means "no target folder known"
	// (e.g. the QuickAdd API, the capture "Capture to" field) — {{FOLDER}}
	// then resolves to an empty string rather than throwing.
	protected targetFolderPath: string | null = null;
	protected templateInclusion?: TemplateInclusionState;
	protected clocks?: RunClocks;

	protected runClocks(): RunClocks | undefined {
		return this.clocks;
	}

	protected abstract format(input: string): Promise<string>;

	public setTemplateInclusionState(state: TemplateInclusionState): void {
		this.templateInclusion = state;
	}
	protected replaceDateInString(input: string): string {
		return replaceDateInString(input, {
			clocks: () => this.runClocks(),
			applyCase: (value, style, token) => this.applyCaseOption(value, style, token),
		});
	}
	protected replaceTimeInString(input: string): string {
		return replaceTimeInString(input, {
			clocks: () => this.runClocks(),
			applyCase: (value, style, token) => this.applyCaseOption(value, style, token),
		});
	}

	protected async replaceSelectedInString(input: string): Promise<string> {
		if (!SELECTED_REGEX.test(input)) return input;

		const selectedText = await this.getSelectedText();
		// Single global function-replacer pass (mirrors replaceClipboardInString):
		// the inserted selection is arbitrary user text and may itself contain the
		// literal "{{SELECTED}}" token, so a re-scanning while-loop would re-match
		// it every iteration and grow without bound, hanging Obsidian (#1358-class).
		// A function replacer inserts it literally and is never re-scanned.
		const regex = new RegExp(SELECTED_REGEX.source, "gi");
		return input.replace(regex, () => selectedText);
	}

	protected async replaceClipboardInString(input: string): Promise<string> {
		if (!CLIPBOARD_REGEX.test(input)) return input;

		const clipboardContent = await this.getClipboardContent();
		const regex = new RegExp(CLIPBOARD_REGEX.source, "gi");
		return input.replace(regex, () => clipboardContent);
	}


	/** Single-token compatibility entry point; production resolves contextual tokens together. */
	protected async replaceLinkToCurrentFileInString(
		input: string,
	): Promise<string> {
		if (!LINK_TO_CURRENT_FILE_REGEX.test(input)) return input;

		const currentFilePathLink = this.getCurrentFileLink();
		if (!currentFilePathLink) {
			if (this.linkToCurrentFileBehavior === "required") {
				throw new Error("Unable to get current file path. Make sure you have a file open in the editor.");
			}
			log.logMessage("Skipping {{LINKCURRENT}} replacement because no active file is available.");
		}

		const regex = new RegExp(LINK_TO_CURRENT_FILE_REGEX.source, "gi");
		return input.replace(regex, () => currentFilePathLink ?? "");
	}

	/** Resolve the cursor heading link only when present, honoring required/optional behavior. */
	protected replaceLinkToCurrentSectionInString(input: string): string {
		if (!LINK_TO_CURRENT_SECTION_REGEX.test(input)) return input;

		const sectionLink = this.getCurrentFileLinkToSection();

		if (!sectionLink) {
			if (this.linkToCurrentFileBehavior === "required") {
				throw new Error("Unable to get current file path. Make sure you have a file open in the editor.");
			}
			log.logMessage("Skipping {{LINKSECTION}} replacement because no active file is available.");
		}

		// Single global pass with a function replacer: the replacement is the
		// generated link, which embeds the (user-controlled) heading text and so
		// can itself contain "{{linksection}}" or "$"-sequences. A function
		// replacer inserts it literally and is NOT re-scanned, avoiding both the
		// $-pattern interpretation and the infinite re-match a while-loop would
		// hit when a heading is literally named "{{linksection}}".
		const regex = new RegExp(LINK_TO_CURRENT_SECTION_REGEX.source, "gi");
		return input.replace(regex, () => sectionLink ?? "");
	}

	/** Resolve link tokens together so generated links containing tokens are never rescanned. */
	protected replaceCurrentFileLinksInString(input: string): string {
		return this.replaceCurrentFileTokensInString(input, { links: true });
	}
	/** Active-folder path tokens must never silently retarget a write to the vault root. */
	protected replaceCurrentFileTokensInString(input: string, opts: CurrentFileTokenOptions): string {
		return replaceCurrentFileTokens(input, opts, {
			LINKCURRENT: () => this.getCurrentFileLink(),
			LINKSECTION: () => this.getCurrentFileLinkToSection(),
			FILENAMECURRENT: () => this.getCurrentFileName(),
			FOLDER: () => this.targetFolderPath ?? "",
			FOLDERCURRENT: () => this.getCurrentFolderPath(),
			TITLE: () => this.getVariableValue("title"),
		}, this.linkToCurrentFileBehavior);
	}

	protected async replaceCurrentFileNameInString(
		input: string,
	): Promise<string> {
		// Routed through the combined single-pass resolver so a file literally
		// named "{{filenamecurrent}}" can't loop (#1358). Kept for direct/legacy
		// callers and unit tests; production resolves all tokens at once via the
		// entry points in CompleteFormatter / the display formatters.
		return this.replaceCurrentFileTokensInString(input, { fileName: true });
	}

	public setLinkToCurrentFileBehavior(behavior: LinkToCurrentFileBehavior) {
		this.linkToCurrentFileBehavior = behavior;
	}

	/**
	 * Records the folder the note is being created in so {{FOLDER}} can resolve
	 * to it. The path is normalized to a clean vault-relative form: leading and
	 * trailing slashes are stripped and the Obsidian vault root ("/" or "")
	 * collapses to an empty string. Pass `null` to clear it.
	 */
	public setTargetFolderPath(path: string | null): void {
		if (path == null) {
			this.targetFolderPath = null;
			return;
		}
		const trimmed = path.trim();
		this.targetFolderPath =
			trimmed === "/" ? "" : trimmed.replace(/^\/+/, "").replace(/\/+$/, "");
	}

	/** Resolve the target folder path or leaf; an unknown folder renders empty. */
	protected replaceTargetFolderInString(input: string): string {
		// Routed through the combined single-pass resolver (kept for direct/legacy
		// callers and unit tests). See {@link replaceCurrentFileTokensInString}.
		return this.replaceCurrentFileTokensInString(input, { folder: true });
	}

	protected abstract getCurrentFileLink(): string | null;
	protected abstract getCurrentFileName(): string | null;

	/** Resolve a link to the cursor heading; subclasses without cursor access use the file link. */
	protected getCurrentFileLinkToSection(): string | null {
		return null;
	}

	/** Active folder: null means no active file; an empty string means the vault root. */
	protected getCurrentFolderPath(): string | null {
		return null;
	}

	protected async replaceFieldVarInString(input: string) {
		const regex = new RegExp(FIELD_VAR_REGEX_WITH_FILTERS.source, "gi");
		let output = "";
		let lastIndex = 0;
		let match: RegExpExecArray | null;

		while ((match = regex.exec(input)) !== null) {
			output += input.slice(lastIndex, match.index);

			// match[1] contains the field name (and potentially the old filter syntax if no pipe is used)
			// match[2] contains the filter part starting with |, if present
			const fullMatch = match[1] + (match[2] || "");

			if (fullMatch) {
				const fieldVariableKey = this.getFieldVariableKey(fullMatch);
				const parsed = FieldSuggestionParser.parse(fullMatch, {
					warnUnknown: true,
					warn: this.warnSink,
				});

				if (!this.hasConcreteVariable(fieldVariableKey)) {
					this.variables.set(
						fieldVariableKey,
						await this.suggestForField(fullMatch, parsed),
					);
				}

				// The FIELD key, not the bare specifier. `getVariableValue` is only
				// reached when the suggester resolved `undefined` (a remote prompt
				// provider can), and looking up `status|folder:Work` there both
				// misses the value that WAS stored and cross-reads the {{VALUE}}
				// namespace, so a `{{VALUE:status}}` answer could be served to a
				// `{{FIELD:status}}` token - the separation FIELD_VARIABLE_PREFIX
				// exists for.
				const rawValue = this.hasConcreteVariable(fieldVariableKey)
					? this.variables.get(fieldVariableKey)
					: this.getVariableValue(fieldVariableKey);
				if (!parsed.multiFormat || parsed.multiFormat === "auto") {
					this.retainSingleTokenValue(input, match.index, match.index + match[0].length, rawValue);
				}
				let replacement: string;

				if (Array.isArray(rawValue)) {
					replacement =
						this.renderCollectedOrArrayValue({
						input,
						matchStart: match.index,
						matchEnd: match.index + match[0].length,
						rawValue,
						fallbackKey: parsed.fieldName,
						heuristicEnabled: false,
						multiFormat: parsed.multiFormat ?? "auto",
						}) ?? rawValue.join(",");
				} else {
					replacement = escapeValueInsideQuotedYamlScalar(
						input,
						match.index,
						match.index + match[0].length,
						String(rawValue ?? ""),
					);
				}

				output += replacement;
			} else {
				output += match[0];
			}

			lastIndex = regex.lastIndex;
		}

		return output + input.slice(lastIndex);
	}

	private getFieldVariableKey(fieldSpecifier: string): string {
		return `${FIELD_VARIABLE_PREFIX}${fieldSpecifier}`;
	}

	/** Resolve FILE tokens once per identity, retaining real picks and custom text as distinct values. */
	protected async replaceFileInString(input: string): Promise<string> {
		const regex = new RegExp(FILE_REGEX.source, "gi");
		let output = "";
		let lastIndex = 0;
		let match: RegExpExecArray | null;

		while ((match = regex.exec(input)) !== null) {
			output += input.slice(lastIndex, match.index);

			const parsed = parseFileToken(match[1] ?? "", {
				warn: this.warnSink,
			});
			if (!parsed) {
				// Empty folder / malformed: leave the token literal and move on.
				output += match[0];
				lastIndex = regex.lastIndex;
				continue;
			}

			const key = parsed.variableKey;
			if (!this.hasConcreteVariable(key)) {
				this.variables.set(key, await this.suggestForFile(parsed));
			}

			const renderedValue = renderStoredFileValue(
				this.variables.get(key),
				parsed.mode,
				(stored) => this.getFileLinkForStoredValue(stored),
			);
			if (Array.isArray(renderedValue)) {
				const replacement = this.renderCollectedOrArrayValue({
					input,
					matchStart: match.index,
					matchEnd: match.index + match[0].length,
					rawValue: renderedValue,
					fallbackKey: parsed.aliasName ?? parsed.folderPath,
					heuristicEnabled: false,
					multiFormat: parsed.multiFormat,
				});
				output += replacement ?? renderedValue.join(",");
			} else {
				output += renderedValue;
			}
			lastIndex = regex.lastIndex;
		}

		return output + input.slice(lastIndex);
	}

	/** Only an encoded vault pick becomes a file link; custom input stays literal. */
	protected getFileLinkForStoredValue(stored: unknown): string {
		const decoded = decodeFileValue(stored);
		if (decoded.kind === "empty") return "";
		if (decoded.kind !== "file") {
			const text = decoded.kind === "custom" ? decoded.text : decoded.value;
			return text ? `[[${text}]]` : "";
		}

		const path = decoded.path;
		if (!path) return "";

		const file = this.app?.vault.getAbstractFileByPath(path);
		if (file instanceof TFile) {
			return (
				this.app?.fileManager.generateMarkdownLink(
					file,
					this.getLinkSourcePath() ?? "",
				) ?? `[[${fileBasenameFromPath(path)}]]`
			);
		}
		return `[[${fileBasenameFromPath(path)}]]`;
	}

	/**
	 * Source path used to resolve {{FILE:...|link}} (and other) wikilinks.
	 * Defaults to none (resolve from the vault root); CaptureChoiceFormatter
	 * overrides this with the capture destination so relative links are correct.
	 */
	protected getLinkSourcePath(): string | null {
		return null;
	}

	/**
	 * Prompts the user to pick a file matching the parsed FILE token and returns
	 * the encoded stored value (`@file:<path>` for a pick, `@filecustom:<text>`
	 * for a |custom type-in, or "" when skipped). Display/preview formatters
	 * return a representative value without prompting.
	 */
	protected abstract suggestForFile(
		parsed: ParsedFileToken,
	): Promise<string | string[]> | string | string[];

	protected abstract promptForMathValue(): Promise<string>;

	protected async replaceMathValueInString(input: string) {
		// Build the output by scanning the current input once.
		// This avoids infinite replacement loops when the provided math input contains {{MVALUE}}.
		const regex = new RegExp(MATH_VALUE_REGEX.source, "gi");

		// An already-collected answer wins, the way {{VALUE}} reads
		// `this.variables` before prompting. `RequirementCollector` registers a
		// requirement keyed "mvalue" for this token, so the one-page input form
		// asks for a "Math expression" and the CLI advertises
		// `value-mvalue=<value>` - and, without this, both answers were dropped:
		// the form asked, then the run opened the math modal on top of it, and
		// the CLI flag it had just recommended made no difference (#1607).
		//
		// READ, never write: leaving `promptForMathValue`'s answer unstored keeps
		// the per-occurrence prompt that `{{MVALUE}} {{MVALUE}}` has always had.
		// A single collected answer legitimately fills every occurrence, because
		// the collector registers exactly one requirement for the token.
		const collected = this.variables.get("mvalue");
		const collectedValue =
			typeof collected === "string" && collected.trim() ? collected : null;

		let output = "";
		let lastIndex = 0;
		let match: RegExpExecArray | null;

		while ((match = regex.exec(input)) !== null) {
			output += input.slice(lastIndex, match.index);
			output += collectedValue ?? (await this.promptForMathValue());
			lastIndex = match.index + match[0].length;
		}

		output += input.slice(lastIndex);
		return output;
	}

	protected async replaceMacrosInString(input: string): Promise<string> {
		let output: string = input;

		while (MACRO_REGEX.test(output)) {
			const exec = MACRO_REGEX.exec(output);
			if (!exec) continue;
			if (!exec[1]) {
				// Empty macro name (e.g. {{MACRO:}}): consume the token so the
				// loop terminates instead of re-testing the unchanged string forever.
				output = this.replacer(output, MACRO_REGEX, "");
				continue;
			}

			const parsed = parseMacroToken(exec[1]);
			if (!parsed) {
				output = this.replacer(output, MACRO_REGEX, "");
				continue;
			}

			const { macroName, label } = parsed;
			const macroOutput = await this.getMacroValue(
				macroName,
				label ? { label } : undefined,
			);

			output = this.replacer(
				output,
				MACRO_REGEX,
				macroOutput ? macroOutput.toString() : "",
			);
		}

		return output;
	}

	/**
	 * @param variableName the WHOLE `{{FIELD:...}}` specifier, filters included.
	 *   It is what the runtime suggesters parse and what the variable is keyed on.
	 * @param parsed the same specifier already parsed by the caller. The preview
	 *   formatters need only `fieldName` from it, and passing it in is what keeps
	 *   their placeholder from reading `status|folder:Work_field_value` (#1579).
	 */
	protected abstract suggestForField(
		variableName: string,
		parsed: { fieldName: string },
	): Promise<string | string[]>;
	protected async replaceDateVariableInString(input: string): Promise<string> {
		return replaceDateVariableInString(input, {
			variables: this.variables, dateParser: this.dateParser, prompt: (name, options) => this.promptForVariable(name, options),
			applyCase: (value, style, token) => this.applyCaseOption(value, style, token),
		});
	}

	protected async replaceTemplateInString(input: string): Promise<string> {
		let output: string = input;

		while (TEMPLATE_REGEX.test(output)) {
			const exec = TEMPLATE_REGEX.exec(output);
			if (!exec || !exec[1]) continue;

			const templatePath = exec[1];
			this.templateInclusion ??= { visited: new Set<string>(), depth: 0 };

			if (this.templateInclusion.visited.has(templatePath)) {
				const placeholder = `[QuickAdd: template inclusion cycle detected at "${templatePath}"]`;
				this.reportProblem(placeholder);
				output = this.replacer(output, TEMPLATE_REGEX, placeholder);
				continue;
			}

			if (this.templateInclusion.depth >= MAX_TEMPLATE_INCLUSION_DEPTH) {
				const placeholder = `[QuickAdd: max template inclusion depth (${MAX_TEMPLATE_INCLUSION_DEPTH}) exceeded at "${templatePath}"]`;
				this.reportProblem(placeholder);
				output = this.replacer(output, TEMPLATE_REGEX, placeholder);
				continue;
			}

			this.templateInclusion.visited.add(templatePath);
			let templateContent: string;
			try {
				templateContent = await this.getTemplateContent(templatePath);
			} finally {
				this.templateInclusion.visited.delete(templatePath);
			}

			output = this.replacer(output, TEMPLATE_REGEX, templateContent);
		}

		return output;
	}

	protected replaceLinebreakInString(input: string): string {
		let output = "";

		for (let i = 0; i < input.length; i++) {
			const curr = input[i];
			const next = input[i + 1];

			if (curr == "\\") {
				if (next == "n") {
					output += "\n";
					i++;
				} else if (next == "\\") {
					output += "\\";
					i++;
				} else {
					// Invalid use of escape character, but we keep it anyway.
					output += '\\';
				}
			} else {
				output += curr;
			}
		}

		return output;
	}

	/** Expand escapes outside tokens and inline scripts; their contents retain literal backslashes. */
	protected expandLinebreakEscapesOutsideTokens(input: string): string {
		const scriptSpans = findInlineScriptSpans(input);
		let output = "";
		let i = 0;
		let spanIdx = 0;

		while (i < input.length) {
			while (spanIdx < scriptSpans.length && scriptSpans[spanIdx].end <= i) {
				spanIdx++;
			}
			const nextSpan = scriptSpans[spanIdx];
			if (nextSpan && nextSpan.start === i) {
				output += input.slice(nextSpan.start, nextSpan.end);
				i = nextSpan.end;
				continue;
			}

			if (input[i] === "{" && input[i + 1] === "{") {
				const close = input.indexOf("}}", i + 2);
				// A `}}` that sits inside a script fence belongs to the script's
				// code, not to this token — the fence wins and the `{{` is plain
				// text. Otherwise the token skip would end mid-fence and the rest
				// of the script would get its `\n` escapes expanded. Any fence can
				// be the victim (the first `}}` may fall in a later fence), so
				// check every span the skip could end inside of.
				let cutsIntoScript = false;
				if (close !== -1) {
					const skipEnd = close + 2;
					for (let k = spanIdx; k < scriptSpans.length; k++) {
						const span = scriptSpans[k];
						if (span.start >= skipEnd) break;
						if (skipEnd < span.end && skipEnd > span.start) {
							cutsIntoScript = true;
							break;
						}
					}
				}
				if (close !== -1 && !cutsIntoScript) {
					output += input.slice(i, close + 2);
					i = close + 2;
					continue;
				}
			}

			const curr = input[i];
			const next = input[i + 1];

			if (curr === "\\") {
				if (next === "n") {
					output += "\n";
					i += 2;
				} else if (next === "\\") {
					output += "\\";
					i += 2;
				} else {
					// Invalid use of escape character, but we keep it anyway.
					output += "\\";
					i += 1;
				}
			} else {
				output += curr;
				i += 1;
			}
		}

		return output;
	}


	protected abstract getMacroValue(
		macroName: string,
		context?: { label?: string },
	): Promise<string> | string;

	protected abstract getTemplateContent(templatePath: string): Promise<string>;

	protected abstract getSelectedText(): Promise<string>;

	protected abstract getClipboardContent(): Promise<string>;

	protected replaceRandomInString(input: string): string {
		let output = input;

		while (RANDOM_REGEX.test(output)) {
			const match = RANDOM_REGEX.exec(output);
			if (!match || !match[1]) continue;

			const length = parseInt(match[1]);
			if (length <= 0 || length > 100) {
				throw new Error(`Random string length must be between 1 and 100. Got: ${length}`);
			}

			const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
			let randomString = '';

			for (let i = 0; i < length; i++) {
				randomString += chars.charAt(Math.floor(Math.random() * chars.length));
			}

			output = output.replace(match[0], randomString);
		}

		return output;
	}

	protected replaceTitleInString(input: string): string {
		// Routed through the combined single-pass resolver so a title literally
		// equal to "{{title}}" can't loop (#1358). Kept for direct/legacy callers
		// and unit tests. See {@link replaceCurrentFileTokensInString}.
		return this.replaceCurrentFileTokensInString(input, { title: true });
	}

	/**
	 * True when `replacePropertyInString` expanded `{{PROPERTY}}` during the
	 * latest format pass. Cleared by {@link consumePropertyTokenExpanded}.
	 * Used so compose mode still applies when macros, templates, or global
	 * variables inject the token after the raw Capture format is read.
	 */
	private propertyTokenExpanded = false;

	/** Whether `{{PROPERTY}}` expanded since the last consume. Clears the flag. */
	public consumePropertyTokenExpanded(): boolean {
		const expanded = this.propertyTokenExpanded;
		this.propertyTokenExpanded = false;
		return expanded;
	}

	/**
	 * Expands `{{PROPERTY}}` to the seeded `propertyValue` snapshot (property
	 * Captures only). Outside that scope the token is a hard error so it cannot
	 * leak as literal text into a note body (#1748).
	 */
	protected replacePropertyInString(input: string): string {
		if (!PROPERTY_REGEX.test(input)) return input;
		if (this.promptScope !== "propertyValue") {
			throw new Error(
				"{{PROPERTY}} can only be used in a property Capture format.",
			);
		}
		this.propertyTokenExpanded = true;
		const raw = this.variables.get("propertyValue");
		if (/^{{PROPERTY}}$/i.test(input.trim()) && input.trim() === input) {
			this.retainSingleTokenValue(
				input,
				0,
				input.length,
				raw === undefined ? "" : raw,
			);
		}
		const text = stringifyPropertyTokenValue(raw);
		return input.replace(new RegExp(PROPERTY_REGEX.source, "gi"), () => text);
	}
}
