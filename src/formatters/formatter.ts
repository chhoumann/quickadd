import type { App } from "obsidian";
import {
	DATE_REGEX,
	DATE_REGEX_FORMATTED,
	DATE_VARIABLE_REGEX,
	LINK_TO_CURRENT_FILE_REGEX,
	FILE_NAME_OF_CURRENT_FILE_REGEX,
	MACRO_REGEX,
	MATH_VALUE_REGEX,
	NAME_VALUE_REGEX,
	NUMBER_REGEX,
	TEMPLATE_REGEX,
	VARIABLE_REGEX,

	FIELD_VAR_REGEX_WITH_FILTERS,
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
import {
	parseAnonymousValueOptions,
	parseValueToken,
	resolveExistingVariableKey,
	type ValueInputType,
} from "../utils/valueSyntax";
import { parseMacroToken } from "../utils/macroSyntax";

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
}

export abstract class Formatter {
	protected value: string;
	protected variables: Map<string, unknown> = new Map<string, unknown>();
	protected dateParser: IDateParser | undefined;
	private linkToCurrentFileBehavior: LinkToCurrentFileBehavior = "required";
	private static readonly FIELD_VARIABLE_PREFIX = "FIELD:";
	protected valuePromptContext?: PromptContext;

	// Tracks variables collected for YAML property post-processing
	private readonly propertyCollector: TemplatePropertyCollector;

	protected constructor(protected readonly app?: App) {
		this.propertyCollector = new TemplatePropertyCollector(app);
	}

	protected abstract format(input: string): Promise<string>;

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
			this.value = existingValue === null ? "" : String(existingValue);
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
	 * Returns the template variables that should be processed as proper property types
	 * and clears the internal tracking.
	 */
	public getAndClearTemplatePropertyVars(): Map<string, unknown> {
		return this.propertyCollector.drain();
	}

	protected abstract getCurrentFileLink(): string | null;
	protected abstract getCurrentFileName(): string | null;



	protected async replaceVariableInString(input: string) {
		let output = input;
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
				variableKey,
				label,
				caseStyle,
				defaultValue,
				allowCustomInput,
				suggestedValues,
				hasOptions,
			} = parsed;

			const resolvedKey = resolveExistingVariableKey(
				this.variables,
				variableKey,
			);

			// Ensure variable is set (prompt if needed)
			if (!resolvedKey) {
				let variableValue = "";
				const helperText =
					!hasOptions && label ? label : undefined;
				const suggesterPlaceholder =
					hasOptions && label ? label : undefined;

				if (!hasOptions) {
					// For single-value prompts, pass default value to pre-populate the input
					variableValue = await this.promptForVariable(variableName, {
						defaultValue,
						description: helperText,
						inputTypeOverride: parsed.inputTypeOverride,
						variableKey,
					});
				} else {
					variableValue = await this.suggestForValue(
						suggestedValues,
						allowCustomInput,
						{ placeholder: suggesterPlaceholder, variableKey },
					);
				}

				// Use default value if no input provided (applies to both prompt and suggester)
				if (!variableValue && defaultValue) {
					variableValue = defaultValue;
				}

				this.variables.set(variableKey, variableValue);
			}

			const effectiveKey = resolvedKey ?? variableKey;

			// Get the raw value from variables
			const rawValue = this.variables.get(effectiveKey);
			const rawValueForCollector =
				caseStyle && typeof rawValue === "string"
					? transformCase(rawValue, caseStyle)
					: rawValue;

			// Offer this variable to the property collector for YAML post-processing
			this.propertyCollector.maybeCollect({
				input: output,
				matchStart: match.index,
				matchEnd: match.index + match[0].length,
				rawValue: rawValueForCollector,
				fallbackKey: variableName,
				featureEnabled: propertyTypesEnabled,
			});

			// Always use string replacement initially
			const rawReplacement = this.getVariableValue(effectiveKey);
			const replacement = transformCase(rawReplacement, caseStyle);

			// Replace in output and adjust regex position
			output = output.slice(0, match.index) + replacement + output.slice(match.index + match[0].length);
			regex.lastIndex = match.index + replacement.length;
		}

		return output;
	}

	protected async replaceFieldVarInString(input: string) {
		let output: string = input;

		// Use the enhanced regex that supports filters
		while (FIELD_VAR_REGEX_WITH_FILTERS.test(output)) {
			const match = FIELD_VAR_REGEX_WITH_FILTERS.exec(output);
			if (!match) throw new Error(`Unable to parse field variable. Invalid syntax in: "${output.substring(Math.max(0, output.search(FIELD_VAR_REGEX_WITH_FILTERS) - 10), Math.min(output.length, output.search(FIELD_VAR_REGEX_WITH_FILTERS) + 30))}..."`);

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

				output = this.replacer(
					output,
					FIELD_VAR_REGEX_WITH_FILTERS,
					replacement,
				);
			} else {
				break;
			}
		}

		return output;
	}

	private getFieldVariableKey(fieldSpecifier: string): string {
		return `${Formatter.FIELD_VARIABLE_PREFIX}${fieldSpecifier}`;
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
			if (!exec || !exec[1]) continue;

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
		context?: { placeholder?: string; variableKey?: string },
	): Promise<string> | string;

	protected abstract suggestForField(variableName: string): Promise<string>;

	protected async replaceDateVariableInString(input: string) {
		let output: string = input;

		while (DATE_VARIABLE_REGEX.test(output)) {
			const match = DATE_VARIABLE_REGEX.exec(output);
			if (!match || !match[1] || !match[2]) break;

			const variableName = match[1].trim();
			const dateFormat = match[2].trim();
			const defaultValue = match[3]?.trim() || undefined;

			// Skip processing if variable name or format is empty
			// This prevents crashes when typing incomplete patterns like {{VDATE:,
			if (!variableName || !dateFormat) {
				break;
			}

			if (variableName && dateFormat) {
				const existingValue = this.variables.get(variableName);

				// Check if we already have this date variable stored
				if (!existingValue) {
					// Prompt for date input with VDATE context
					const dateInput = await this.promptForVariable(
						variableName,
						{ type: "VDATE", dateFormat, defaultValue }
					);
					if (dateInput?.startsWith("@date:")) {
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
								`unable to parse date variable ${dateInput}`,
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
					formattedDate = `${storedValue}`;
				}

				// Replace the specific match rather than using regex again
				// to handle multiple VDATE variables with same name but different formats
				output = output.replace(match[0], formattedDate);
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
			const templateContent = await this.getTemplateContent(templatePath);

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
