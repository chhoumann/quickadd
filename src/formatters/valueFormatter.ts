
import type { App } from "obsidian";
import { NAME_VALUE_REGEX, VARIABLE_REGEX } from "../constants";
import {
	valueAnswersWholeScope,
	type PromptRunContext,
	type PromptScopeKind,
} from "./promptScope";
import { log } from "../logger/logManager";
import { TemplatePropertyCollector } from "../utils/TemplatePropertyCollector";
import {
	isSupportedCaseStyle,
	SUPPORTED_CASE_STYLES,
	transformCase,
} from "../utils/caseTransform";
import { getYamlPlaceholder } from "../utils/yamlValues";
import {
	escapeValueInsideQuotedYamlScalar,
	isTokenExactlyQuotedYamlScalar,
	quoteYamlDouble,
	shouldQuoteTextScalar,
} from "../utils/yamlScalarQuoting";
import {
	renderExplicitMultiValue,
	writesPicksAsItems,
	type MultiValueFormat,
} from "../utils/multiValueFormat";
import { toWikiLink } from "../utils/linkWrap";
import {
	type ParsedValueToken,
	parseAnonymousValueOptions,
	parseValueToken,
	resolveExistingVariableKey,
	type NumericInputConfig,
	type SliderConfig,
	type ValueInputType,
} from "../utils/valueSyntax";
import { SILENT_WARN, type WarnSink } from "../utils/warnSink";
import { formatUnknownValue } from "../utils/conditionalHelpers";

export interface PromptContext {
	type?: string;
	dateFormat?: string;
	defaultValue?: string;
	label?: string;
	description?: string;
	placeholder?: string;
	variableKey?: string;
	inputTypeOverride?: ValueInputType; // Undefined means use global input prompt setting.
	numericConfig?: NumericInputConfig;
	sliderConfig?: SliderConfig;
	optional?: boolean; // Token carries |optional: empty submissions are accepted as the answer.
	withTime?: boolean; // VDATE |time/|datetime: render a date AND time picker.
}

const TYPED_SCALAR_OVERRIDES: ReadonlySet<string> = new Set([
	"number",
	"slider",
	"checkbox",
]);

/** VALUE token resolution, prompt scope, and structured property collection. */
export abstract class ValueFormatter {

	protected value: string;
	protected variables: Map<string, unknown> = new Map<string, unknown>();
	protected valuePromptContext?: PromptContext;
	/** Declared prompt scope, restored by withPromptScope across nested formatting. */
	protected promptScope: PromptScopeKind = "generic";
	/** Whether an anonymous {{VALUE}} answers the whole of what the scope names. */
	protected promptScopeSoleValue = false;
	/** Which choice is asking and, once known, where the answer lands. */
	protected promptRunContext?: PromptRunContext;

	// Tracks variables collected for YAML property post-processing
	private readonly propertyCollector: TemplatePropertyCollector;
	private templatePropertyCollectionDepth = 0;
	private singleTokenValue?: { input: string; result?: { value: unknown } };
	/** Set while formatting a list property value, where each pick of a list is one line, so one item. */
	protected listPicksAsLines = false;

	/** A format that is exactly one token or one inline script keeps its native value (number, list, ...). */
	protected async preserveSingleTokenValue(input: string, work: () => Promise<string>): Promise<unknown> {
		const previous = this.singleTokenValue;
		const capture: typeof this.singleTokenValue = /^(?:\{\{(?:VALUE|NAME)(?::[^{}]+|\|[^{}]+)?\}\}|\{\{(?:FIELD|FILE):[^{}]+\}\}|\{\{PROPERTY\}\}|`{3,}js quickadd[\s\S]*`{3,})$/i.test(input)
			? { input }
			: undefined;
		this.singleTokenValue = capture;
		try {
			const text = await work();
			return capture?.result && typeof capture.result.value !== "string" ? capture.result.value : text;
		} finally {
			this.singleTokenValue = previous;
		}
	}

	protected retainSingleTokenValue(input: string, start: number, end: number, value: unknown): boolean {
		if (this.singleTokenValue?.input === input && start === 0 && end === input.length) {
			this.singleTokenValue.result = { value };
			return true;
		}
		return false;
	}

	private propertyTokenValue(value: unknown, inputType?: string): unknown {
		if (inputType === "text") return formatUnknownValue(value);
		if (inputType === "checkbox") {
			if (typeof value === "boolean") return value;
			if (value === "true") return true;
			if (value === "false") return false;
			throw new Error("A checkbox property value must be true or false.");
		}
		if (inputType === "number" || inputType === "slider") {
			if (typeof value === "number" && Number.isFinite(value)) return value;
			if (typeof value !== "string" || !/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(value.trim()) || !Number.isFinite(Number(value))) {
				throw new Error("A number property value must be a finite number.");
			}
			return Number(value);
		}
		return value;
	}

	// Warn once per conflicting named option signature across the whole run, independent of answers.
	private readonly namedSuggesterOptionSigs = new Map<string, string>();
	private readonly namedSuggesterConflictsWarned = new Set<string>();

	protected constructor(protected readonly app?: App) {
		this.propertyCollector = new TemplatePropertyCollector(app);
	}

	/** Runtime warnings produce Notices; previews collect diagnostics and preflight may suppress them. */
	protected warn(message: string): void {
		log.logWarning(message);
	}

	/**
	 * Like {@link warn}, for a problem that stopped a token from resolving at all
	 * (a template inclusion cycle, exceeding the inclusion depth). Named
	 * `reportProblem` rather than `reportError` so it is not mistaken for the
	 * widely imported `errorUtils.reportError`.
	 */
	protected reportProblem(message: string): void {
		log.logError(message);
	}

	/** Bound warning sink because parsers invoke it without the formatter receiver. */
	protected readonly warnSink: WarnSink = (message) => this.warn(message);

	/**
	 * Merges into the run context describing which choice is asking and where its
	 * output lands. Engines call this at run start with the choice, then again
	 * with `destination` as soon as the target resolves.
	 */
	public setPromptRunContext(context: PromptRunContext): void {
		this.promptRunContext = { ...this.promptRunContext, ...context };
	}

	public getPromptRunContext(): PromptRunContext | undefined {
		return this.promptRunContext;
	}

	/**
	 * Runs `fn` with the prompt scope set to what `input` will become. Restored in
	 * a `finally` so a throwing pass cannot leak its scope into the next one -
	 * exactly the bug the sticky `valueHeader` this replaces used to have, where
	 * a Capture's file-name pass silently retitled its body prompt.
	 */
	public async withPromptScope<T>(
		scope: PromptScopeKind,
		input: string,
		fn: () => Promise<T>,
	): Promise<T> {
		const previousScope = this.promptScope;
		const previousSoleValue = this.promptScopeSoleValue;
		this.promptScope = scope;
		this.promptScopeSoleValue = valueAnswersWholeScope(scope, input);
		try {
			return await fn();
		} finally {
			this.promptScope = previousScope;
			this.promptScopeSoleValue = previousSoleValue;
		}
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

	public getAnonymousValue(): string | undefined {
		return this.value;
	}

	protected replacer(str: string, reg: RegExp, replaceValue: string) {
		return str.replace(reg, function () {
			return replaceValue;
		});
	}

	protected applyCaseOption(
		value: string,
		style: string | undefined,
		tokenDisplay: string,
	): string {
		if (!style) return value;
		if (!isSupportedCaseStyle(style)) {
			this.warn(
				`QuickAdd: Unsupported |case style "${style}" in token "${tokenDisplay}". Supported styles: ${SUPPORTED_CASE_STYLES.join(", ")}.`,
			);
			return value;
		}
		return transformCase(value, style);
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
		output = output.replace(regex, (...args) => {
			const token = args[0];
			const offset = args[args.length - 2] as number;
			const source = args[args.length - 1] as string;
			const inner = token.slice(2, -2);
			const optionsIndex = inner.indexOf("|");
			if (optionsIndex === -1) {
				this.retainSingleTokenValue(source, offset, offset + token.length,
					this.hasConcreteVariable("value") ? this.variables.get("value") : this.value);
				return escapeValueInsideQuotedYamlScalar(
					source,
					offset,
					offset + token.length,
					this.value,
				);
			}
			const rawOptions = inner.slice(optionsIndex);
			const parsed = parseAnonymousValueOptions(rawOptions, {
				warn: this.warnSink,
			});
			// An empty submission takes the default unless |optional explicitly permits empty.
			const effectiveValue =
				this.value === "" && parsed.defaultValue && !parsed.optional
					? parsed.defaultValue
					: this.value;
			const transformed = this.applyValueTextOptions(effectiveValue, parsed);
			if (this.singleTokenValue) {
				const rawValue = this.value === "" && parsed.defaultValue && !parsed.optional
					? parsed.defaultValue
					: this.hasConcreteVariable("value") ? this.variables.get("value") : this.value;
				this.retainSingleTokenValue(source, offset, offset + token.length,
					this.propertyTokenValue(this.applyValueTokenOptions(rawValue, parsed), parsed.inputTypeOverride));
			}
			// |type:text on the anonymous {{VALUE|...}} form quotes the same way
			// as the named form (see replaceVariableInString).
			if (
				parsed.inputTypeOverride === "text" &&
				transformed !== "" &&
				shouldQuoteTextScalar(source, offset, offset + token.length)
			) {
				return quoteYamlDouble(transformed);
			}
			// Same contract as the named form: a value substituted inside an
			// author-quoted front matter scalar must be escaped for those quotes.
			return escapeValueInsideQuotedYamlScalar(
				source,
				offset,
				offset + token.length,
				transformed,
			);
		});

		return output;
	}

	private applyValueTextOptions(
		value: unknown,
		options: { trim?: boolean; caseStyle?: string },
	): string {
		const text = String(value ?? "");
		const trimmed = options.trim ? text.trim() : text;
		return transformCase(trimmed, options.caseStyle);
	}

	private applyValueTokenOptions(
		value: unknown,
		parsed: Pick<ParsedValueToken, "trim" | "caseStyle">,
	): unknown {
		if (Array.isArray(value)) {
			return parsed.trim
				? value.map((item) =>
						typeof item === "string" ? item.trim() : item,
					)
				: value;
		}
		if (typeof value === "string") {
			return this.applyValueTextOptions(value, parsed);
		}
		return value;
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

			// Silent: this is the prompt-context pre-pass; the actual replacer
			// pass (replaceValueInString) emits any |case warning so it fires
			// once, not twice.
			const parsed = parseAnonymousValueOptions(rawOptions, {
				warn: SILENT_WARN,
			});
			if (!context) context = {};

			if (!context.description && parsed.label) {
				context.description = parsed.label;
			}
			if (!context.defaultValue && parsed.defaultValue) {
				context.defaultValue = parsed.defaultValue;
			}
			if (parsed.inputTypeOverride && !context.inputTypeOverride) {
				context.inputTypeOverride = parsed.inputTypeOverride;
			}
			if (parsed.numericConfig && !context.numericConfig) {
				context.numericConfig = parsed.numericConfig;
			}
			if (parsed.sliderConfig && !context.sliderConfig) {
				context.sliderConfig = parsed.sliderConfig;
			}
			if (parsed.optional) {
				context.optional = true;
			}
		}

		return context;
	}

	/**
	 * Returns the template variables that should be processed as proper property types
	 * and clears the internal tracking.
	 */
	public getAndClearTemplatePropertyVars(): Map<string, unknown> {
		return this.propertyCollector.drain();
	}

	public mergeTemplatePropertyVars(vars: Map<string, unknown>): void {
		this.propertyCollector.merge(vars);
	}

	/** Collect sole frontmatter values before rendering arrays. Callers retain scalar policy. */
	protected renderCollectedOrArrayValue(args: {
		input: string;
		matchStart: number;
		matchEnd: number;
		rawValue: unknown;
		fallbackKey: string;
		heuristicEnabled: boolean;
		multiFormat?: MultiValueFormat;
	}): string | undefined {
		if (this.listPicksAsLines && Array.isArray(args.rawValue) && writesPicksAsItems({ ...args, format: args.multiFormat })) {
			const picks = args.rawValue.map(String);
			const whole = this.retainSingleTokenValue(args.input, args.matchStart, args.matchEnd, args.rawValue);
			// Lines are the item boundary, so a pick with a line break would silently become several items.
			if (!whole && picks.some((pick) => /[\r\n]/.test(pick))) {
				throw new Error("A list item that contains a line break can only be written when its token is the whole Capture format.");
			}
			return picks.join("\n");
		}
		if (!args.multiFormat || args.multiFormat === "auto") {
			this.retainSingleTokenValue(args.input, args.matchStart, args.matchEnd, args.rawValue);
		}
		if (Array.isArray(args.rawValue) && args.multiFormat) {
			const explicit = renderExplicitMultiValue({
				input: args.input,
				matchStart: args.matchStart,
				values: args.rawValue,
				format: args.multiFormat,
			});
			if (explicit !== undefined) return explicit;
		}

		const structuredYamlValue = this.propertyCollector.maybeCollect({
			...args,
			collectionActive: this.templatePropertyCollectionDepth > 0,
		});
		const placeholder = getYamlPlaceholder(structuredYamlValue);
		if (placeholder !== undefined) return placeholder;
		if (Array.isArray(args.rawValue)) {
			return escapeValueInsideQuotedYamlScalar(
				args.input,
				args.matchStart,
				args.matchEnd,
				args.rawValue.join(","),
			);
		}
		return undefined;
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

	/** Warn once per run when a named suggester is defined with conflicting option lists. */
	private warnOnNamedOptionConflict(parsed: ParsedValueToken): void {
		if (!parsed.aliasName || !parsed.hasOptions) return;
		const nameKey = parsed.variableKey.toLowerCase();
		// Include options, custom input, display mapping, and multi-select shape in conflict detection.
		const signature = JSON.stringify([
			parsed.suggestedValues,
			parsed.allowCustomInput,
			parsed.displayValues ?? null,
			parsed.multiSelect,
			parsed.multiEmit,
		]);
		const previous = this.namedSuggesterOptionSigs.get(nameKey);
		if (previous === undefined) {
			this.namedSuggesterOptionSigs.set(nameKey, signature);
			return;
		}
		if (previous !== signature && !this.namedSuggesterConflictsWarned.has(nameKey)) {
			this.namedSuggesterConflictsWarned.add(nameKey);
			// Use the warning hook so previews collect this conflict without emitting Notices.
			this.warn(
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

		const helperText = !hasOptions && label ? label : undefined;
		// A picker in a property Capture is answering for that property, so it is named after it.
		const propertyKey = this.promptScope === "propertyValue" ? this.variables.get("propertyKey") : undefined;
		const suggesterPlaceholder = hasOptions
			? label || (typeof propertyKey === "string" ? propertyKey : undefined)
			: undefined;

		// |multi opens a multi-select picker and stores a real ARRAY so the
		// property collector writes a proper YAML list (no beta flag needed).
		if (hasOptions && parsed.multiSelect) {
			const picked = await this.suggestForValueMulti(
				suggestedValues,
				allowCustomInput,
				{
					placeholder: suggesterPlaceholder,
					variableKey,
					displayValues,
					optional: parsed.optional,
				},
			);
			this.variables.set(
				variableKey,
				parsed.multiEmit === "linklist" ? picked.map(toWikiLink) : picked,
			);
			return variableKey;
		}

		let variableValue = "";

		if (!hasOptions) {
			// For single-value prompts, pass default value to pre-populate the input
			variableValue = await this.promptForVariable(variableName, {
				defaultValue,
				description: helperText,
				inputTypeOverride: parsed.inputTypeOverride,
				numericConfig: parsed.numericConfig,
				sliderConfig: parsed.sliderConfig,
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

	/** Resolve named suggester definitions before references so ordering does not cause duplicate prompts. */
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
				// Silent: the main pass parses again and owns the user-facing warnings.
				parsed = parseValueToken(match[1], { warn: SILENT_WARN });
			} catch {
				// A malformed token throws in the main pass; abort hoisting so the
				// error surfaces before any suggester is shown.
				return;
			}
			if (parsed) tokens.push({ parsed, index: match.index });
		}

		// Track bare references only: counting definitions as uses would let later definitions win.
		const firstUseIndex = new Map<string, number>();
		for (const { parsed, index } of tokens) {
			if (parsed.hasOptions && parsed.aliasName) continue; // skip definitions
			const key = parsed.variableKey.toLowerCase();
			if (!firstUseIndex.has(key)) firstUseIndex.set(key, index);
		}

		const seen = new Set<string>();
		for (const { parsed, index } of tokens) {
			if (!parsed.hasOptions || !parsed.aliasName) continue;
			const key = parsed.variableKey.toLowerCase();
			// Only hoist when a bare reuse precedes this definition.
			if ((firstUseIndex.get(key) ?? index) >= index) continue;
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

			const parsed = parseValueToken(match[1], { warn: this.warnSink });
			if (!parsed) {
				throw new Error(`Unable to parse variable. Invalid syntax in: "${output.substring(Math.max(0, match.index - 10), Math.min(output.length, match.index + 30))}..."`);
			}

			const { variableName } = parsed;

			const effectiveKey = await this.ensureValueVariableResolved(parsed);

			// Get the raw value from variables
			const rawValue = this.variables.get(effectiveKey);
			const effectiveRawValue = this.applyValueTokenOptions(rawValue, parsed);
			if (this.singleTokenValue && (!parsed.multiFormat || parsed.multiFormat === "auto")) {
				this.retainSingleTokenValue(output, match.index, match.index + match[0].length,
					this.propertyTokenValue(effectiveRawValue, parsed.inputTypeOverride));
			}

			// Collect containers in YAML regardless of the flag; only string coercion is opt-in.
			const structuredReplacement = this.renderCollectedOrArrayValue({
				input: output,
				matchStart: match.index,
				matchEnd: match.index + match[0].length,
				rawValue: this.singleTokenValue?.result ? this.singleTokenValue.result.value : effectiveRawValue,
				fallbackKey: variableName,
				// |type:text forces a string: never run the string->structured
				// heuristic on it, or a comma/bracket value (`a,b`, `[x]`) would be
				// collected as a List and bypass the quoting path below.
				heuristicEnabled:
					propertyTypesEnabled &&
					this.templatePropertyCollectionDepth > 0 &&
					parsed.inputTypeOverride !== "text",
				multiFormat: parsed.multiFormat,
			});

			// Keep interim YAML parseable, and replacements textual so non-string answers cannot desync scanning.
			let replacement: string;
			let consumeQuotes = false;
			if (structuredReplacement !== undefined) {
				replacement = structuredReplacement;
			} else {
				const stringVal = String(
					this.applyValueTextOptions(
						this.getVariableValue(effectiveKey),
						parsed,
					) ?? "",
				);
				// |type:text (#757): write the value as a quoted YAML string at a
				// sole-value front-matter position so Obsidian can't retype it
				// (e.g. "0042" -> 42, "true" -> boolean, "#todo" -> a comment).
				const quote =
					parsed.inputTypeOverride === "text" &&
					stringVal !== "" &&
					shouldQuoteTextScalar(
						output,
						match.index,
						match.index + match[0].length,
					);
				if (quote) {
					replacement = quoteYamlDouble(stringVal);
				} else if (
					TYPED_SCALAR_OVERRIDES.has(parsed.inputTypeOverride ?? "") &&
					isTokenExactlyQuotedYamlScalar(
						output,
						match.index,
						match.index + match[0].length,
					)
				) {
					// Typed number/boolean overrides consume surrounding quotes; text and multiline retain string semantics.
					consumeQuotes = true;
					replacement = stringVal;
				} else {
					replacement = escapeValueInsideQuotedYamlScalar(
						output,
						match.index,
						match.index + match[0].length,
						stringVal,
					);
				}
			}

			// Replace in output and adjust regex position
			const replaceStart = consumeQuotes ? match.index - 1 : match.index;
			const replaceEnd =
				match.index + match[0].length + (consumeQuotes ? 1 : 0);
			output = output.slice(0, replaceStart) + replacement + output.slice(replaceEnd);
			regex.lastIndex = replaceStart + replacement.length;
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

	/** Multi-select VALUE answers remain arrays for YAML collection; inert formatters default to empty. */
	protected suggestForValueMulti(
		_suggestedValues: string[],
		_allowCustomInput?: boolean,
		_context?: {
			placeholder?: string;
			variableKey?: string;
			displayValues?: string[];
			optional?: boolean;
		},
	): Promise<string[]> | string[] {
		return [];
	}

	protected abstract promptForVariable(
		variableName: string,
		context?: PromptContext,
	): Promise<string>;

	/**
	 * Returns whether template property types feature is enabled in settings.
	 */
	protected abstract isTemplatePropertyTypesEnabled(): boolean;
}
