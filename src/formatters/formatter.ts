import type { App } from "obsidian";
import {
	DATE_REGEX,
	DATE_REGEX_FORMATTED,
	DATE_VARIABLE_REGEX,
	LINK_TO_CURRENT_FILE_REGEX,
	FILE_NAME_OF_CURRENT_FILE_REGEX,
	TARGET_FOLDER_REGEX,
	MACRO_REGEX,
	MATH_VALUE_REGEX,
	NAME_VALUE_REGEX,
	NUMBER_REGEX,
	TEMPLATE_REGEX,
	VARIABLE_REGEX,

	FIELD_VAR_REGEX_WITH_FILTERS,
	FIELD_VARIABLE_PREFIX,
	SELECTED_REGEX,
	CLIPBOARD_REGEX,
	TIME_REGEX,
	TIME_REGEX_FORMATTED,
	TITLE_REGEX,
	RANDOM_REGEX,
} from "../constants";
import { getDate } from "../utilityObsidian";
import type { IDateParser } from "../parsers/IDateParser";
import { log } from "../logger/logManager";
import { TemplatePropertyCollector } from "../utils/TemplatePropertyCollector";
import { settingsStore } from "../settingsStore";
import { normalizeDateInput } from "../utils/dateAliases";
import { transformCase } from "../utils/caseTransform";
import { getYamlPlaceholder } from "../utils/yamlValues";
import {
	type ParsedValueToken,
	parseAnonymousValueOptions,
	parseValueToken,
	resolveExistingVariableKey,
	type ValueInputType,
} from "../utils/valueSyntax";
import { parseVDateOptions } from "../utils/vdateSyntax";
import { parseMacroToken } from "../utils/macroSyntax";
import { formatUnknownValue } from "../utils/conditionalHelpers";

export type LinkToCurrentFileBehavior = "required" | "optional";

export interface PromptContext {
	type?: string;
	dateFormat?: string;
	defaultValue?: string;
	label?: string;
	description?: string;
	placeholder?: string;
	variableKey?: string;
	inputTypeOverride?: ValueInputType; // Undefined means use global input prompt setting.
	optional?: boolean; // Token carries |optional: empty submissions are accepted as the answer.
}

export interface TemplateInclusionState {
	visited: Set<string>;
	depth: number;
}

const MAX_TEMPLATE_INCLUSION_DEPTH = 10;

export abstract class Formatter {
	protected value: string;
	protected variables: Map<string, unknown> = new Map<string, unknown>();
	protected dateParser: IDateParser | undefined;
	private linkToCurrentFileBehavior: LinkToCurrentFileBehavior = "required";
	// The folder the note is being created in, supplied by the engine before
	// formatting a file name / body. `null` means "no target folder known"
	// (e.g. the QuickAdd API, the capture "Capture to" field) — {{FOLDER}}
	// then resolves to an empty string rather than throwing.
	protected targetFolderPath: string | null = null;
	protected valuePromptContext?: PromptContext;
	protected templateInclusion?: TemplateInclusionState;

	// Tracks variables collected for YAML property post-processing
	private readonly propertyCollector: TemplatePropertyCollector;
	private templatePropertyCollectionDepth = 0;

	// Detects the same |name being defined with conflicting option lists across
	// one execution (filename + body share this instance). Keyed name -> option
	// signature; conflicts warn once. Value-independent so externally-seeded or
	// custom-typed values never produce a false positive.
	private readonly namedSuggesterOptionSigs = new Map<string, string>();
	private readonly namedSuggesterConflictsWarned = new Set<string>();

	protected constructor(protected readonly app?: App) {
		this.propertyCollector = new TemplatePropertyCollector(app);
	}

	protected abstract format(input: string): Promise<string>;

	public setTemplateInclusionState(state: TemplateInclusionState): void {
		this.templateInclusion = state;
	}

	/** Returns true when a variable is present AND its value is not undefined.
	 *  Null and empty string are considered intentional values. */
	protected hasConcreteVariable(name: string): boolean {
		if (!this.variables.has(name)) return false;
		return this.variables.get(name) !== undefined;
	}

	public setTitle(title: string): void {
		// Only set title if it hasn't been manually set by a script
		// This preserves script-provided values for {{VALUE:title}}
		if (!this.hasConcreteVariable("title")) {
			this.variables.set("title", title);
		}
	}

	protected replacer(str: string, reg: RegExp, replaceValue: string) {
		return str.replace(reg, function () {
			return replaceValue;
		});
	}

	protected replaceDateInString(input: string) {
		let output: string = input;

		while (DATE_REGEX.test(output)) {
			const dateMatch = DATE_REGEX.exec(output);
			let offset: number | undefined;

			if (dateMatch && dateMatch[1]) {
				const offsetString = dateMatch[1].replace("+", "").trim();
				const offsetIsInt = NUMBER_REGEX.test(offsetString);
				if (offsetIsInt) offset = parseInt(offsetString);
			}
			output = this.replacer(output, DATE_REGEX, getDate({ offset: offset }));
		}

		while (DATE_REGEX_FORMATTED.test(output)) {
			const dateMatch = DATE_REGEX_FORMATTED.exec(output);
			if (!dateMatch) throw new Error(`Unable to parse date format. Invalid syntax in: "${output.substring(Math.max(0, output.search(DATE_REGEX_FORMATTED) - 10), Math.min(output.length, output.search(DATE_REGEX_FORMATTED) + 30))}..."`);

			const format = dateMatch[1];
			let offset: number | undefined;

			if (dateMatch[2]) {
				const offsetString = dateMatch[2].replace("+", "").trim();
				const offsetIsInt = NUMBER_REGEX.test(offsetString);
				if (offsetIsInt) offset = parseInt(offsetString);
			}

			output = this.replacer(
				output,
				DATE_REGEX_FORMATTED,
				getDate({ format, offset: offset }),
			);
		}

		return output;
	}

	protected replaceTimeInString(input: string): string {
		let output: string = input;

		while (TIME_REGEX.test(output)) {
			const timeMatch = TIME_REGEX.exec(output);
			if (!timeMatch) throw new Error(`Unable to parse time format. Invalid syntax in: "${output.substring(Math.max(0, output.search(TIME_REGEX) - 10), Math.min(output.length, output.search(TIME_REGEX) + 30))}..."`);

			output = this.replacer(output, TIME_REGEX, getDate({ format: "HH:mm" }));
		}

		while (TIME_REGEX_FORMATTED.test(output)) {
			const timeMatch = TIME_REGEX_FORMATTED.exec(output);
			if (!timeMatch) throw new Error(`Unable to parse formatted time. Invalid syntax in: "${output.substring(Math.max(0, output.search(TIME_REGEX_FORMATTED) - 10), Math.min(output.length, output.search(TIME_REGEX_FORMATTED) + 30))}..."`);

			const format = timeMatch[1];

			output = this.replacer(output, TIME_REGEX_FORMATTED, getDate({ format }));
		}

		return output;
	}

	protected abstract promptForValue(header?: string): Promise<string> | string;

	protected async replaceValueInString(input: string): Promise<string> {
		let output: string = input;

		// Fast path: nothing to do.
		if (!NAME_VALUE_REGEX.test(output)) return output;

		this.valuePromptContext = this.getValuePromptContext(output);

		// Preserve programmatic VALUE injection via reserved variable name `value`.
		if (this.hasConcreteVariable("value")) {
			const existingValue = this.variables.get("value");
			this.value = formatUnknownValue(existingValue);
		}

		// Prompt only once per formatter run (empty string is a valid value).
		if (this.value === undefined) {
			this.value = await this.promptForValue();
		}

		// Replace all occurrences in a single non-recursive pass.
		// Important: use a replacer function so `$` in user input is treated literally.
		const regex = new RegExp(NAME_VALUE_REGEX.source, "gi");
		output = output.replace(regex, (token) => {
			const inner = token.slice(2, -2);
			const optionsIndex = inner.indexOf("|");
			if (optionsIndex === -1) return this.value;
			const rawOptions = inner.slice(optionsIndex);
			const parsed = parseAnonymousValueOptions(rawOptions);
			return transformCase(this.value, parsed.caseStyle);
		});

		return output;
	}

	private getValuePromptContext(input: string): PromptContext | undefined {
		const regex = new RegExp(NAME_VALUE_REGEX.source, "gi");
		let match: RegExpExecArray | null;
		let context: PromptContext | undefined;

		while ((match = regex.exec(input)) !== null) {
			const token = match[0];
			const inner = token.slice(2, -2);
			const optionsIndex = inner.indexOf("|");
			if (optionsIndex === -1) continue;
			const rawOptions = inner.slice(optionsIndex);

			const parsed = parseAnonymousValueOptions(rawOptions);
			if (!context) context = {};

			if (!context.description && parsed.label) {
				context.description = parsed.label;
			}
			if (!context.defaultValue && parsed.defaultValue) {
				context.defaultValue = parsed.defaultValue;
			}
			if (parsed.inputTypeOverride === "multiline") {
				context.inputTypeOverride = "multiline";
			}
			if (parsed.optional) {
				context.optional = true;
			}
		}

		return context;
	}

	protected async replaceSelectedInString(input: string): Promise<string> {
		let output: string = input;

		const selectedText = await this.getSelectedText();

		while (SELECTED_REGEX.test(output)) {
			output = this.replacer(output, SELECTED_REGEX, selectedText);
		}

		return output;
	}

	protected async replaceClipboardInString(input: string): Promise<string> {
		let output: string = input;

		const clipboardContent = await this.getClipboardContent();

		while (CLIPBOARD_REGEX.test(output)) {
			output = this.replacer(output, CLIPBOARD_REGEX, clipboardContent);
		}

		return output;
	}


	protected async replaceLinkToCurrentFileInString(
		input: string,
	): Promise<string> {
		const currentFilePathLink = this.getCurrentFileLink();
		let output = input;

		if (!currentFilePathLink && LINK_TO_CURRENT_FILE_REGEX.test(output)) {
			if (this.linkToCurrentFileBehavior === "required") {
				throw new Error("Unable to get current file path. Make sure you have a file open in the editor.");
			}
			log.logMessage("Skipping {{LINKCURRENT}} replacement because no active file is available.");
			while (LINK_TO_CURRENT_FILE_REGEX.test(output)) {
				output = this.replacer(output, LINK_TO_CURRENT_FILE_REGEX, "");
			}
			return output;
		} else if (!currentFilePathLink) return output; // No need to throw, there's no {{LINKCURRENT}} + we can skip while loop.

		while (LINK_TO_CURRENT_FILE_REGEX.test(output))
			output = this.replacer(
				output,
				LINK_TO_CURRENT_FILE_REGEX,
				currentFilePathLink,
			);

		return output;
	}

	protected async replaceCurrentFileNameInString(
		input: string,
	): Promise<string> {
		const currentFileName = this.getCurrentFileName();
		let output = input;

		if (!currentFileName && FILE_NAME_OF_CURRENT_FILE_REGEX.test(output)) {
			if (this.linkToCurrentFileBehavior === "required") {
				throw new Error("Unable to get current file name. Make sure you have a file open in the editor.");
			}
			log.logMessage("Skipping {{FILENAMECURRENT}} replacement because no active file is available.");
			while (FILE_NAME_OF_CURRENT_FILE_REGEX.test(output)) {
				output = this.replacer(output, FILE_NAME_OF_CURRENT_FILE_REGEX, "");
			}
			return output;
		} else if (!currentFileName) return output;

		while (FILE_NAME_OF_CURRENT_FILE_REGEX.test(output))
			output = this.replacer(
				output,
				FILE_NAME_OF_CURRENT_FILE_REGEX,
				currentFileName,
			);

		return output;
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

	/**
	 * Resolves {{FOLDER}} to the target folder's vault-relative path, and
	 * {{FOLDER|name}} to just its leaf segment. Uses a replacer function so any
	 * `$` in a folder name is treated literally (consistent with the other
	 * tokens). Runs as a contextual pass (from formatFileName / formatFileContent
	 * / formatFolderPath), not from the core format() pipeline. When no target
	 * folder is known it resolves to an empty string (matching runtime in the
	 * capture "Capture to" field, the API, and macro paths).
	 */
	protected replaceTargetFolderInString(input: string): string {
		const fullPath = this.targetFolderPath ?? "";
		const slashIndex = fullPath.lastIndexOf("/");
		const leafName =
			slashIndex === -1 ? fullPath : fullPath.slice(slashIndex + 1);
		const regex = new RegExp(TARGET_FOLDER_REGEX.source, "gi");
		return input.replace(regex, (_match, modifier) =>
			modifier ? leafName : fullPath,
		);
	}

	/**
	 * Returns the template variables that should be processed as proper property types
	 * and clears the internal tracking.
	 */
	public getAndClearTemplatePropertyVars(): Map<string, unknown> {
		return this.propertyCollector.drain();
	}

	/**
	 * Runs a formatting operation in a scope where structured YAML values should
	 * be collected and replaced with temporary placeholders for later
	 * `processFrontMatter()` post-processing.
	 */
	public async withTemplatePropertyCollection<T>(
		work: () => Promise<T>,
	): Promise<T> {
		this.templatePropertyCollectionDepth += 1;

		try {
			return await work();
		} finally {
			this.templatePropertyCollectionDepth -= 1;
		}
	}

	protected abstract getCurrentFileLink(): string | null;
	protected abstract getCurrentFileName(): string | null;



	/**
	 * Warn once when the same `|name` is given two different option lists in one
	 * execution (e.g. {{VALUE:bug,feature|name:type}} and
	 * {{VALUE:book,movie|name:type}}). Named reuse is first-write-wins, so the
	 * second definition silently reuses the first value; the warning surfaces the
	 * likely mistake. Uses the option list itself (not the resolved value), so
	 * seeded/scripted/custom values never trip it.
	 */
	private warnOnNamedOptionConflict(parsed: ParsedValueToken): void {
		if (!parsed.aliasName || !parsed.hasOptions) return;
		const nameKey = parsed.variableKey.toLowerCase();
		// Capture everything that changes the suggester behaviour — the
		// options, the custom-input flag, and the display mapping — so a
		// reordered definition that differs in any of these is flagged.
		const signature = JSON.stringify([
			parsed.suggestedValues,
			parsed.allowCustomInput,
			parsed.displayValues ?? null,
		]);
		const previous = this.namedSuggesterOptionSigs.get(nameKey);
		if (previous === undefined) {
			this.namedSuggesterOptionSigs.set(nameKey, signature);
			return;
		}
		if (previous !== signature && !this.namedSuggesterConflictsWarned.has(nameKey)) {
			this.namedSuggesterConflictsWarned.add(nameKey);
			console.warn(
				`QuickAdd: named value "${parsed.variableKey}" is defined with different option lists; the first definition's value is reused.`,
			);
		}
	}

	/**
	 * Resolve a parsed VALUE token into `this.variables` (prompting/suggesting
	 * only if it isn't already cached) and return the key its value lives under.
	 * Shared by the named-definition pre-pass and the main replacement loop so
	 * the prompt/suggest/default/store logic has a single source of truth.
	 */
	private async ensureValueVariableResolved(
		parsed: ParsedValueToken,
	): Promise<string> {
		const {
			variableName,
			variableKey,
			label,
			defaultValue,
			allowCustomInput,
			suggestedValues,
			displayValues,
			hasOptions,
		} = parsed;

		this.warnOnNamedOptionConflict(parsed);

		const resolvedKey = resolveExistingVariableKey(
			this.variables,
			variableKey,
		);

		if (resolvedKey) return resolvedKey;

		let variableValue = "";
		const helperText = !hasOptions && label ? label : undefined;
		const suggesterPlaceholder = hasOptions && label ? label : undefined;

		if (!hasOptions) {
			// For single-value prompts, pass default value to pre-populate the input
			variableValue = await this.promptForVariable(variableName, {
				defaultValue,
				description: helperText,
				inputTypeOverride: parsed.inputTypeOverride,
				variableKey,
				optional: parsed.optional,
			});
		} else {
			variableValue = await this.suggestForValue(
				suggestedValues,
				allowCustomInput,
				{
					placeholder: suggesterPlaceholder,
					variableKey,
					displayValues,
					optional: parsed.optional,
				},
			);
		}

		// Use default value if no input provided (applies to both prompt and suggester).
		// Optional tokens take the empty submission at face value: the default is
		// visibly pre-filled, so an empty box means the user cleared it.
		if (!variableValue && defaultValue && !parsed.optional) {
			variableValue = defaultValue;
		}

		this.variables.set(variableKey, variableValue);
		return variableKey;
	}

	/**
	 * Two-pass support: resolve named suggester DEFINITIONS
	 * ({{VALUE:a,b,c|name:x}}) before the main pass so a bare reuse site
	 * ({{VALUE:x}}) earlier in the same string resolves from cache instead of
	 * silently degrading to a free-text prompt. A definition is hoisted ONLY
	 * when a reference to its name appears BEFORE it; otherwise document order
	 * already resolves it, so unrelated prompts are never reordered.
	 */
	private async resolveNamedSuggesterDefinitions(
		input: string,
	): Promise<void> {
		// Fast path: nothing to hoist unless a |name: option is present.
		if (!/\|\s*name\s*:/i.test(input)) return;

		const regex = new RegExp(VARIABLE_REGEX.source, "gi");
		const tokens: { parsed: ParsedValueToken; index: number }[] = [];
		let match: RegExpExecArray | null;

		while ((match = regex.exec(input)) !== null) {
			if (!match[1]) continue;
			let parsed: ParsedValueToken | null;
			try {
				// Quiet: the main pass parses again and owns the user-facing warnings.
				parsed = parseValueToken(match[1], { quiet: true });
			} catch {
				// A malformed token throws in the main pass; abort hoisting so the
				// error surfaces before any suggester is shown.
				return;
			}
			if (parsed) tokens.push({ parsed, index: match.index });
		}

		// Earliest index each (case-insensitive) key is referenced at — mirrors
		// resolveExistingVariableKey's case-insensitive matching.
		const firstIndex = new Map<string, number>();
		for (const { parsed, index } of tokens) {
			const key = parsed.variableKey.toLowerCase();
			if (!firstIndex.has(key)) firstIndex.set(key, index);
		}

		const seen = new Set<string>();
		for (const { parsed, index } of tokens) {
			if (!parsed.hasOptions || !parsed.aliasName) continue;
			const key = parsed.variableKey.toLowerCase();
			// Only hoist when a use precedes this definition.
			if ((firstIndex.get(key) ?? index) >= index) continue;
			if (seen.has(key)) continue;
			seen.add(key);
			await this.ensureValueVariableResolved(parsed);
		}
	}

	protected async replaceVariableInString(input: string) {
		let output = input;

		// Pass 1: resolve named suggester definitions up front (see above).
		await this.resolveNamedSuggesterDefinitions(output);

		// Pass 2: replace every VALUE token in document order.
		const regex = new RegExp(VARIABLE_REGEX.source, 'gi'); // preserve case-insensitive + global
		const propertyTypesEnabled = this.isTemplatePropertyTypesEnabled();
		let match: RegExpExecArray | null;

		while ((match = regex.exec(output)) !== null) {
			if (!match[1]) {
				throw new Error(`Unable to parse variable. Invalid syntax in: "${output.substring(Math.max(0, match.index - 10), Math.min(output.length, match.index + 30))}..."`);
			}

			const parsed = parseValueToken(match[1]);
			if (!parsed) {
				throw new Error(`Unable to parse variable. Invalid syntax in: "${output.substring(Math.max(0, match.index - 10), Math.min(output.length, match.index + 30))}..."`);
			}

			const {
				variableName,
				caseStyle,
			} = parsed;

			const effectiveKey = await this.ensureValueVariableResolved(parsed);

			// Get the raw value from variables
			const rawValue = this.variables.get(effectiveKey);
			const rawValueForCollector =
				caseStyle && typeof rawValue === "string"
					? transformCase(rawValue, caseStyle)
					: rawValue;

			// Offer this variable to the property collector for YAML post-processing
			const structuredYamlValue = this.propertyCollector.maybeCollect({
				input: output,
				matchStart: match.index,
				matchEnd: match.index + match[0].length,
				rawValue: rawValueForCollector,
				fallbackKey: variableName,
				featureEnabled:
					propertyTypesEnabled &&
					this.templatePropertyCollectionDepth > 0,
			});

			// Keep the interim frontmatter YAML-parseable until post-processing
			// writes the real structured value back through Obsidian.
			const placeholder = getYamlPlaceholder(structuredYamlValue);
			const replacement = placeholder ??
				transformCase(this.getVariableValue(effectiveKey), caseStyle);

			// Replace in output and adjust regex position
			output = output.slice(0, match.index) + replacement + output.slice(match.index + match[0].length);
			regex.lastIndex = match.index + replacement.length;
		}

		return output;
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

				if (!this.hasConcreteVariable(fieldVariableKey)) {
					this.variables.set(
						fieldVariableKey,
						await this.suggestForField(fullMatch),
					);
				}

				const replacement = this.hasConcreteVariable(fieldVariableKey)
					? String(this.variables.get(fieldVariableKey))
					: this.getVariableValue(fullMatch);

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

	protected abstract promptForMathValue(): Promise<string>;

	protected async replaceMathValueInString(input: string) {
		// Build the output by scanning the current input once.
		// This avoids infinite replacement loops when the provided math input contains {{MVALUE}}.
		const regex = new RegExp(MATH_VALUE_REGEX.source, "gi");

		let output = "";
		let lastIndex = 0;
		let match: RegExpExecArray | null;

		while ((match = regex.exec(input)) !== null) {
			output += input.slice(lastIndex, match.index);
			output += await this.promptForMathValue();
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

	protected abstract getVariableValue(variableName: string): string;

	protected abstract suggestForValue(
		suggestedValues: string[],
		allowCustomInput?: boolean,
		context?: {
			placeholder?: string;
			variableKey?: string;
			displayValues?: string[];
			optional?: boolean;
		},
	): Promise<string> | string;

	protected abstract suggestForField(variableName: string): Promise<string>;

	protected async replaceDateVariableInString(input: string) {
		let output: string = input;

		while (DATE_VARIABLE_REGEX.test(output)) {
			const match = DATE_VARIABLE_REGEX.exec(output);
			if (!match || !match[1]) break;

			const variableName = match[1].trim();
			const dateFormat = match[2]?.trim() || "YYYY-MM-DD";
			const { defaultValue, optional } = parseVDateOptions(match[3]);

			// Skip processing if variable name or format is empty
			// This prevents crashes when typing incomplete patterns like {{VDATE:,
			if (!variableName) {
				break;
			}

			if (variableName) {
				const existingValue = this.variables.get(variableName);

				// Check if we already have this date variable stored.
				// Only `undefined` counts as unset — null and "" are intentional
				// values (same contract as VALUE variables, see #872), so a
				// script-set "" renders empty instead of re-prompting.
				if (existingValue === undefined) {
					// Prompt for date input with VDATE context
					const dateInput = await this.promptForVariable(
						variableName,
						{ type: "VDATE", dateFormat, defaultValue, optional }
					);
					if (optional && !dateInput?.trim()) {
						// Optional date left blank or skipped: answered-empty.
						this.variables.set(variableName, "");
					} else if (dateInput?.startsWith("@date:")) {
						this.variables.set(variableName, dateInput);
					} else {
						if (!this.dateParser)
							throw new Error("Date parser is not available");

						const aliasMap = settingsStore.getState().dateAliases;
						const normalizedInput = normalizeDateInput(
							dateInput,
							aliasMap,
						);
						const parseAttempt = this.dateParser.parseDate(normalizedInput);

						if (parseAttempt) {
							// Store the ISO string with a special prefix
							this.variables.set(
								variableName,
								`@date:${parseAttempt.moment.toISOString()}`,
							);
						} else {
							throw new Error(
								`unable to parse date variable ${dateInput}${
									optional
										? ""
										: ". Tip: add |optional inside the {{VDATE}} token to allow leaving this date empty"
								}`,
							);
						}
					}
				}

				// Format the date based on what's stored
				let formattedDate = "";
				let storedValue = this.variables.get(variableName);

				// If a VDATE variable was pre-seeded (e.g., via API/URL) as a plain string,
				// attempt to coerce it into the internal @date:ISO form so formatting works.
				if (
					typeof storedValue === "string" &&
					storedValue &&
					!storedValue.startsWith("@date:")
				) {
					if (this.dateParser) {
						const aliasMap = settingsStore.getState().dateAliases;
						const normalizedInput = normalizeDateInput(storedValue, aliasMap);
						const parseAttempt = this.dateParser.parseDate(normalizedInput);

						// Keep backwards compatibility: only coerce if we can parse it.
						if (parseAttempt) {
							const iso = parseAttempt.moment.toISOString();
							const coerced = `@date:${iso}`;
							this.variables.set(variableName, coerced);
							storedValue = coerced;
						}
					}
				} else if (storedValue instanceof Date) {
					// Some callers may pass actual Date objects through the JS API.
					if (!Number.isNaN(storedValue.getTime())) {
						const coerced = `@date:${storedValue.toISOString()}`;
						this.variables.set(variableName, coerced);
						storedValue = coerced;
					}
				}

				if (typeof storedValue === "string" && storedValue.startsWith("@date:")) {
					// It's a date variable, extract and format it
					const isoString = storedValue.substring(6);

					if (this.dateParser && window.moment) {
						const moment = window.moment(isoString);
						if (moment && moment.isValid()) {
							formattedDate = moment.format(dateFormat);
						}
					}
				} else if (typeof storedValue === "string" && storedValue) {
					// Backward compatibility: use the stored value as-is
					formattedDate = storedValue;
				} else if (storedValue != null) {
					// Fallback: avoid throwing if a non-string value is stored.
					formattedDate = formatUnknownValue(storedValue);
				}

				// Replace the specific match rather than using regex again
				// to handle multiple VDATE variables with same name but different formats.
				// Replacer function so `$` patterns in stored values are literal —
				// a raw string replacement would re-expand `$&` into the token and
				// loop forever.
				output = output.replace(match[0], () => formattedDate);
			} else {
				break;
			}
		}

		return output;
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
				log.logError(placeholder);
				output = this.replacer(output, TEMPLATE_REGEX, placeholder);
				continue;
			}

			if (this.templateInclusion.depth >= MAX_TEMPLATE_INCLUSION_DEPTH) {
				const placeholder = `[QuickAdd: max template inclusion depth (${MAX_TEMPLATE_INCLUSION_DEPTH}) exceeded at "${templatePath}"]`;
				log.logError(placeholder);
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

	/**
		* Like replaceLinebreakInString, but leaves `{{...}}` token spans untouched.
		* Format-token regexes cannot match across real linebreaks (see constants.ts),
		* so expanding `\n` inside token options (e.g. `{{VALUE:x|default:a\nb}}`)
		* would render the token unparseable and dump it literally into the output.
		*/
	protected expandLinebreakEscapesOutsideTokens(input: string): string {
		let output = "";
		let i = 0;

		while (i < input.length) {
			if (input[i] === "{" && input[i + 1] === "{") {
				const close = input.indexOf("}}", i + 2);
				if (close !== -1) {
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

	protected abstract promptForVariable(
		variableName: string,
		context?: PromptContext,
	): Promise<string>;

	protected abstract getTemplateContent(templatePath: string): Promise<string>;

	protected abstract getSelectedText(): Promise<string>;

	protected abstract getClipboardContent(): Promise<string>;

	/**
	 * Returns whether template property types feature is enabled in settings.
	 */
	protected abstract isTemplatePropertyTypesEnabled(): boolean;

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
		let output = input;
		const title = this.getVariableValue("title");

		while (TITLE_REGEX.test(output)) {
			output = this.replacer(output, TITLE_REGEX, title);
		}

		return output;
	}
}
