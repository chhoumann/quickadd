import {
	extractBareFlagPart,
	parseBooleanFlag,
	parsePipeKeyValue,
	splitPipeParts,
	stripLeadingPipe,
} from "./pipeSyntax";
import { log } from "../logger/logManager";

// Internal-only delimiter for scoping labeled VALUE lists. Unlikely to appear in user input.
export const VALUE_LABEL_KEY_DELIMITER = "\u001F";

export type ValueInputType =
	| "multiline"
	| "number"
	| "slider"
	| "checkbox"
	| "text";

export type NumericInputConfig = {
	min?: number;
	max?: number;
	step?: number;
};

export type SliderConfig = {
	min: number;
	max: number;
	step: number;
};

// Types that render a different input widget but are meaningless alongside a
// comma option-list or |custom (those already pick from a fixed/free set).
const OPTION_INCOMPATIBLE_TYPES = new Set<ValueInputType>([
	"multiline",
	"number",
	"slider",
	"checkbox",
	"text",
]);

const NUMERIC_RANGE_OPTION_KEYS = new Set(["min", "max", "step"]);

const VALUE_OPTION_KEYS = new Set([
	"label",
	"default",
	"custom",
	"type",
	"case",
	"text",
	"optional",
	"trim",
	"multi",
]);

export type MultiEmit = "text" | "linklist";

// `name` is recognized ONLY on the named `{{VALUE:...}}` grammar, never on the
// anonymous `{{VALUE|...}}` grammar (which shares parseOptions). Gating it here
// keeps `{{VALUE|name:x}}` parsing its old "name:x" default unchanged.
const NAMED_VALUE_OPTION_KEYS = new Set([...VALUE_OPTION_KEYS, "name"]);

// Variable keys QuickAdd populates itself; a `|name:` alias must not hijack them.
const RESERVED_VALUE_NAMES = new Set(["value", "title"]);

export type ParsedValueToken = {
	raw: string;
	variableName: string;
	variableKey: string;
	/** Explicit reusable key from `|name:`; undefined when not provided. */
	aliasName?: string;
	label?: string;
	caseStyle?: string;
	defaultValue: string;
	allowCustomInput: boolean;
	suggestedValues: string[];
	displayValues?: string[];
	hasOptions: boolean;
	inputTypeOverride?: ValueInputType;
	numericConfig?: NumericInputConfig;
	sliderConfig?: SliderConfig;
	optional: boolean;
	/** Trims leading/trailing whitespace from this token's rendered value. */
	trim: boolean;
	/** |multi: pick several options into a YAML list (option-list tokens only). */
	multiSelect: boolean;
	/** |multi:linklist wraps each pick as [[name]]; defaults to plain text. */
	multiEmit: MultiEmit;
};

export function buildValueVariableKey(
	variableName: string,
	label: string | undefined,
	hasOptions: boolean,
): string {
	return hasOptions && label
		? `${variableName}${VALUE_LABEL_KEY_DELIMITER}${label}`
		: variableName;
}

export function getValueVariableBaseName(variableKey: string): string {
	const delimiterIndex = variableKey.indexOf(VALUE_LABEL_KEY_DELIMITER);
	if (delimiterIndex === -1) return variableKey;
	return variableKey.slice(0, delimiterIndex);
}

function findCaseInsensitiveMatch(
	vars: Map<string, unknown>,
	candidate: string,
): string | null {
	const lower = candidate.toLowerCase();
	let match: string | null = null;

	for (const key of vars.keys()) {
		if (key.toLowerCase() !== lower) continue;
		if (vars.get(key) === undefined) continue;
		if (match) return null;
		match = key;
	}

	return match;
}

export function resolveExistingVariableKey(
	vars: Map<string, unknown>,
	variableKey: string,
): string | null {
	if (!variableKey) return null;

	const candidates = [variableKey];
	const baseKey = getValueVariableBaseName(variableKey);
	if (baseKey !== variableKey) candidates.push(baseKey);

	for (const candidate of candidates) {
		if (vars.has(candidate) && vars.get(candidate) !== undefined) {
			return candidate;
		}

		const match = findCaseInsensitiveMatch(vars, candidate);
		if (match) return match;
	}

	return null;
}

type ParsedOptions = {
	label?: string;
	caseStyle?: string;
	defaultValue: string;
	allowCustomInput: boolean;
	usesOptions: boolean;
	inputTypeOverride?: string;
	minRaw?: string;
	maxRaw?: string;
	stepRaw?: string;
	displayValuesRaw?: string;
	optionalExplicit?: boolean;
	trimExplicit?: boolean;
	name?: string;
	multiSelect?: boolean;
	multiEmit?: MultiEmit;
};

/**
 * Pulls bare `optional` flag parts out of a pipe-part list BEFORE the
 * usesOptions decision, so shorthand defaults next to the flag keep working:
 * `{{VALUE:x|tomorrow|optional}}` still means default "tomorrow" + optional.
 * A literal default "optional" needs the `|default:optional` escape hatch.
 */
function extractBareOptionalFlag(parts: string[]): {
	remaining: string[];
	optional: boolean;
} {
	const { remaining, found } = extractBareFlagPart(parts, "optional");
	return { remaining, optional: found };
}

function extractBareValueFlags(parts: string[]): {
	remaining: string[];
	optional: boolean;
	trim: boolean;
} {
	const { remaining: withoutOptional, optional } =
		extractBareOptionalFlag(parts);
	const { remaining, found: trim } = extractBareFlagPart(
		withoutOptional,
		"trim",
	);
	return { remaining, optional, trim };
}

function hasRecognizedOption(part: string, allowName: boolean): boolean {
	const trimmed = part.trim();
	if (!trimmed) return false;
	const parsed = parsePipeKeyValue(trimmed);
	if (!parsed) return false;
	const keys = allowName ? NAMED_VALUE_OPTION_KEYS : VALUE_OPTION_KEYS;
	return keys.has(parsed.key);
}

function hasNumericType(optionParts: string[], allowName: boolean): boolean {
	const optionKeys = allowName ? NAMED_VALUE_OPTION_KEYS : VALUE_OPTION_KEYS;
	return optionParts.some((part) => {
		const parsed = parsePipeKeyValue(part.trim());
		if (!parsed || parsed.key !== "type" || !optionKeys.has("type")) return false;
		const value = parsed.value.trim().toLowerCase();
		return value === "number" || value === "slider";
	});
}

function parseOptions(
	optionParts: string[],
	hasOptions: boolean,
	allowName: boolean,
	quiet = false,
): ParsedOptions {
	if (optionParts.length === 0) {
		return {
			defaultValue: "",
			allowCustomInput: false,
			usesOptions: false,
		};
	}

	const optionKeys = allowName ? NAMED_VALUE_OPTION_KEYS : VALUE_OPTION_KEYS;
	const allowNumericOptions = hasNumericType(optionParts, allowName);
	const hasExplicitOption = optionParts.some((part) =>
		hasRecognizedOption(part, allowName) ||
		(allowNumericOptions &&
			NUMERIC_RANGE_OPTION_KEYS.has(
				parsePipeKeyValue(part.trim())?.key ?? "",
			)),
	);
	const hasCustomFlag =
		hasOptions &&
		optionParts.some(
			(part) => part.trim().toLowerCase() === "custom",
		);
	const hasMultiFlag =
		hasOptions &&
		optionParts.some((part) => part.trim().toLowerCase() === "multi");
	const usesOptions = hasExplicitOption || hasCustomFlag || hasMultiFlag;

	if (!usesOptions) {
		return {
			defaultValue: optionParts.join("|").trim(),
			allowCustomInput: false,
			usesOptions: false,
		};
	}

	let label: string | undefined;
	let caseStyle: string | undefined;
	let defaultValue = "";
	let allowCustomInput = false;
	let inputTypeOverride: string | undefined;
	let minRaw: string | undefined;
	let maxRaw: string | undefined;
	let stepRaw: string | undefined;
	let displayValuesRaw: string | undefined;
	let optionalExplicit: boolean | undefined;
	let trimExplicit: boolean | undefined;
	let name: string | undefined;
	let multiSelect = false;
	let multiEmit: MultiEmit | undefined;

	for (const part of optionParts) {
		const trimmed = part.trim();
		if (!trimmed) continue;

		if (hasOptions && trimmed.toLowerCase() === "custom") {
			allowCustomInput = true;
			continue;
		}

		if (hasOptions && trimmed.toLowerCase() === "multi") {
			multiSelect = true;
			continue;
		}

		const parsed = parsePipeKeyValue(trimmed);
		if (!parsed) continue;
		const { key, value } = parsed;
		if (
			!optionKeys.has(key) &&
			!(allowNumericOptions && NUMERIC_RANGE_OPTION_KEYS.has(key))
		)
			continue;

		switch (key) {
			case "label":
				if (value) label = value;
				break;
			case "case":
				if (value) caseStyle = value;
				break;
			case "default":
				defaultValue = value;
				break;
			case "custom":
				allowCustomInput = parseBooleanFlag(value);
				break;
			case "type":
				if (value) inputTypeOverride = value;
				break;
			case "min":
				minRaw = value;
				break;
			case "max":
				maxRaw = value;
				break;
			case "step":
				stepRaw = value;
				break;
			case "text":
				displayValuesRaw = value;
				break;
			case "optional":
				optionalExplicit = parseBooleanFlag(value);
				break;
			case "trim":
				trimExplicit = parseBooleanFlag(value);
				break;
			case "multi":
				multiSelect = true;
				multiEmit =
					value.trim().toLowerCase() === "linklist" ? "linklist" : "text";
				break;
			case "name":
				// Gated to the named grammar via optionKeys; empty `|name:` is a
				// no-op alias and warns so the author notices the typo.
				if (value) name = value;
				else if (!quiet)
					log.logWarning(
						`QuickAdd: empty |name: ignored; provide a variable name, e.g. {{VALUE:a,b|name:category}}.`,
					);
				break;
			default:
				break;
		}
	}

	return {
		label,
		caseStyle,
		defaultValue,
		allowCustomInput,
		name,
		usesOptions: true,
		inputTypeOverride,
		minRaw,
		maxRaw,
		stepRaw,
		displayValuesRaw,
		optionalExplicit,
		trimExplicit,
		multiSelect,
		multiEmit,
	};
}

function resolveInputType(
	rawType: string | undefined,
	{
		tokenDisplay,
		hasOptions,
		allowCustomInput,
	}: { tokenDisplay: string; hasOptions: boolean; allowCustomInput: boolean },
	quiet = false,
): ValueInputType | undefined {
	if (!rawType) return undefined;
	const raw = rawType.trim().toLowerCase();
	// `boolean` is a friendly alias for the checkbox true/false picker.
	const normalized = (raw === "boolean" ? "checkbox" : raw) as ValueInputType;
	if (!OPTION_INCOMPATIBLE_TYPES.has(normalized)) {
		if (!quiet)
			log.logWarning(
				`QuickAdd: Unsupported VALUE type "${rawType}" in token "${tokenDisplay}". Supported types: multiline, number, slider, checkbox, text.`,
			);
		return undefined;
	}
	if (hasOptions || allowCustomInput) {
		if (!quiet)
			log.logWarning(
				`QuickAdd: Ignoring type:${normalized} for option-list VALUE token "${tokenDisplay}".`,
			);
		return undefined;
	}
	return normalized;
}

function parseFiniteNumber(value: string | undefined): number | undefined {
	if (value === undefined) return undefined;
	const trimmed = value.trim();
	if (!trimmed) return undefined;
	const parsed = Number(trimmed);
	return Number.isFinite(parsed) ? parsed : undefined;
}

function hasNumericConfig(options: ParsedOptions): boolean {
	return (
		options.minRaw !== undefined ||
		options.maxRaw !== undefined ||
		options.stepRaw !== undefined
	);
}

function buildNumericConfig(
	options: ParsedOptions,
	tokenDisplay: string,
	quiet: boolean,
): NumericInputConfig | undefined {
	const min = parseFiniteNumber(options.minRaw);
	const max = parseFiniteNumber(options.maxRaw);
	const step = parseFiniteNumber(options.stepRaw);
	const config: NumericInputConfig = {};

	if (options.minRaw !== undefined) {
		if (min === undefined) {
			if (!quiet)
				log.logWarning(
					`QuickAdd: Ignoring invalid min in VALUE token "${tokenDisplay}".`,
				);
		} else {
			config.min = min;
		}
	}

	if (options.maxRaw !== undefined) {
		if (max === undefined) {
			if (!quiet)
				log.logWarning(
					`QuickAdd: Ignoring invalid max in VALUE token "${tokenDisplay}".`,
				);
		} else {
			config.max = max;
		}
	}

	if (
		config.min !== undefined &&
		config.max !== undefined &&
		config.max < config.min
	) {
		if (!quiet)
			log.logWarning(
				`QuickAdd: Ignoring invalid numeric range in VALUE token "${tokenDisplay}"; max must be greater than or equal to min.`,
			);
		delete config.min;
		delete config.max;
	}

	if (options.stepRaw !== undefined) {
		if (step === undefined || step <= 0) {
			if (!quiet)
				log.logWarning(
					`QuickAdd: Ignoring invalid step in VALUE token "${tokenDisplay}"; step must be greater than 0.`,
				);
		} else {
			config.step = step;
		}
	}

	return Object.keys(config).length > 0 ? config : undefined;
}

function resolveNumericInput(
	options: ParsedOptions,
	tokenDisplay: string,
	inputTypeOverride: ValueInputType | undefined,
	quiet: boolean,
): {
	inputTypeOverride?: ValueInputType;
	numericConfig?: NumericInputConfig;
	sliderConfig?: SliderConfig;
} {
	if (inputTypeOverride !== "number" && inputTypeOverride !== "slider") {
		if (hasNumericConfig(options) && !quiet) {
			log.logWarning(
				`QuickAdd: Ignoring numeric range options in "${tokenDisplay}" because type is not number or slider.`,
			);
		}
		return { inputTypeOverride };
	}

	if (inputTypeOverride !== "slider") {
		const numericConfig = buildNumericConfig(options, tokenDisplay, quiet);
		return { inputTypeOverride, numericConfig };
	}

	const min = parseFiniteNumber(options.minRaw);
	const max = parseFiniteNumber(options.maxRaw);
	const step = options.stepRaw === undefined
		? 1
		: parseFiniteNumber(options.stepRaw);
	const invalidReason =
		min === undefined || max === undefined
			? "slider requires finite min and max values"
			: max <= min
				? "max must be greater than min"
				: step === undefined || step <= 0
					? "step must be greater than 0"
					: undefined;

	if (invalidReason) {
		if (!quiet) {
			log.logWarning(
				`QuickAdd: Invalid slider configuration in "${tokenDisplay}" (${invalidReason}); falling back to type:number.`,
			);
		}
		const numericConfig = buildNumericConfig(options, tokenDisplay, true);
		return { inputTypeOverride: "number", numericConfig };
	}

	const sliderConfig: SliderConfig = {
		min: min as number,
		max: max as number,
		step: step as number,
	};
	return {
		inputTypeOverride,
		numericConfig: sliderConfig,
		sliderConfig,
	};
}

function decimalPlaces(value: number): number {
	const asString = String(value);
	const exponentMatch = /e-(\d+)$/i.exec(asString);
	if (exponentMatch) return Number(exponentMatch[1]);
	const decimalIndex = asString.indexOf(".");
	return decimalIndex === -1 ? 0 : asString.length - decimalIndex - 1;
}

function formatRoundedNumber(value: number, precision: number): string {
	return String(Number(value.toFixed(precision)));
}

export function normalizeNumericValue(
	value: string | undefined,
	config?: NumericInputConfig,
): string {
	const trimmed = value?.trim() ?? "";
	if (!trimmed) return "";

	const parsed = Number(trimmed);
	if (!Number.isFinite(parsed)) return "";

	const min = config?.min;
	const max = config?.max;
	let normalized = parsed;
	if (min !== undefined) normalized = Math.max(min, normalized);
	if (max !== undefined) normalized = Math.min(max, normalized);

	if (config?.step !== undefined && config.step > 0) {
		const base = min ?? 0;
		const stepsFromBase = Math.round((normalized - base) / config.step);
		normalized = base + stepsFromBase * config.step;
		if (min !== undefined) normalized = Math.max(min, normalized);
		if (max !== undefined) normalized = Math.min(max, normalized);
		const precision = Math.max(
			decimalPlaces(base),
			decimalPlaces(config.step),
		);
		return formatRoundedNumber(normalized, precision);
	}

	return String(normalized);
}

export function normalizeSliderValue(
	value: string | undefined,
	config: SliderConfig,
): string {
	const normalized = normalizeNumericValue(value, config);
	return normalized || String(config.min);
}

// The "double-quote class" that opens/closes a quoted option: the straight
// double quote plus the curly pair editors (and Obsidian) auto-substitute. The
// reporter's own example in #239 pastes a curly close-quote (U+201D), so curly
// quotes must work, not just `"`. Single quotes/apostrophes are intentionally
// NOT special — they are ubiquitous in option text (Bob's, 'tis).
const DOUBLE_QUOTE_CHARS = new Set(['"', "“", "”"]);

function isDoubleQuote(ch: string | undefined): boolean {
	return ch !== undefined && DOUBLE_QUOTE_CHARS.has(ch);
}

// Horizontal whitespace only (space, tab, NBSP, other Unicode spaces) — NOT
// line breaks. VALUE tokens never contain newlines (constants.ts VARIABLE_REGEX
// excludes them), but excluding them here keeps the helper safe if reused.
const HORIZONTAL_WS = /[^\S\r\n]/;

/**
 * Split a comma-separated VALUE option list while honoring double-quoted fields,
 * so a comma inside `"..."` stays literal (#239). CSV-style rules:
 *   - A field is quoted only when it STARTS with a double-quote (after optional
 *     leading whitespace); a quote anywhere else is literal.
 *   - Inside a quoted field, `""` is one literal quote and a comma is literal.
 *   - A closing quote is only honored when the next non-space char is a comma or
 *     end-of-input (STRICT close).
 *
 * Any input that is not cleanly quote-balanced — an unterminated quote, or a
 * quote "closed" by other text (e.g. `"a"b`) — falls back to a plain comma
 * split. That guarantees every token WITHOUT a balanced double-quoted field
 * parses byte-identically to the pre-#239 behavior.
 *
 * Returns raw fields with the surrounding quotes stripped; callers apply the
 * usual `.map(trim).filter(Boolean)`. Whitespace inside quotes is therefore not
 * preserved — quoting protects commas, which survive the trim.
 */
export function splitQuotedCommaList(input: string): string[] {
	const fields: string[] = [];
	let buf = "";
	let inQuotes = false;

	for (let i = 0; i < input.length; i++) {
		const ch = input[i];

		if (inQuotes) {
			if (isDoubleQuote(ch)) {
				if (isDoubleQuote(input[i + 1])) {
					// Doubled quote -> one literal straight quote.
					buf += '"';
					i++;
					continue;
				}
				// Candidate close: valid only if followed by ws* then `,`/EOF.
				let j = i + 1;
				while (j < input.length && HORIZONTAL_WS.test(input[j])) j++;
				if (j >= input.length || input[j] === ",") {
					inQuotes = false;
					i = j - 1; // skip the trailing whitespace up to the delimiter
					continue;
				}
				// Quote closed by other text -> not real quoting; keep legacy.
				return input.split(",");
			}
			buf += ch; // commas (and everything else) are literal inside quotes
			continue;
		}

		if (ch === ",") {
			fields.push(buf);
			buf = "";
			continue;
		}
		if (isDoubleQuote(ch) && buf.trim() === "") {
			// Opening quote: drop any leading whitespace already buffered.
			inQuotes = true;
			buf = "";
			continue;
		}
		buf += ch;
	}

	if (inQuotes) return input.split(","); // unterminated quote -> legacy
	fields.push(buf);
	return fields;
}

/**
 * Strip a single surrounding double-quote pair from one value, applying the same
 * `""` -> `"` unescape as {@link splitQuotedCommaList}. Used to unwrap a
 * `|default:"a, b"` on an option-list token so the default matches its
 * now-unquoted option (in both the preflight form and the runtime fallback).
 * Unquoted values pass through unchanged.
 */
export function unwrapQuotedValue(value: string): string {
	const trimmed = value.trim();
	if (!isDoubleQuote(trimmed[0])) return value;
	// Reuse the list grammar so unwrapping matches splitting exactly (strict
	// close, doubled-quote escape). Only a single, fully balanced quoted field is
	// unwrapped; anything that falls back to a literal split is left untouched.
	const fields = splitQuotedCommaList(trimmed);
	if (fields.length === 1 && fields[0] !== trimmed) return fields[0].trim();
	return value;
}

export function parseValueToken(
	raw: string,
	opts?: { quiet?: boolean },
): ParsedValueToken | null {
	if (!raw) return null;
	const quiet = opts?.quiet ?? false;

	const parts = splitPipeParts(raw);
	const variablePart = (parts.shift() ?? "").trim();
	if (!variablePart) return null;

	const suggestedValues = splitQuotedCommaList(variablePart)
		.map((value) => value.trim())
		.filter(Boolean);
	const hasOptions = suggestedValues.length > 1;

	const {
		remaining: optionParts,
		optional: bareOptional,
		trim: bareTrim,
	} = extractBareValueFlags(parts);
	const options = parseOptions(optionParts, hasOptions, true, quiet);
	let { label, caseStyle, defaultValue, allowCustomInput } = options;
	let multiSelect = options.multiSelect ?? false;
	const multiEmit: MultiEmit = options.multiEmit ?? "text";
	const optional = options.optionalExplicit ?? bareOptional;
	const trim = options.trimExplicit ?? bareTrim;

	if (!options.usesOptions) {
		const legacyDefault = defaultValue;
		allowCustomInput = hasOptions && legacyDefault.toLowerCase() === "custom";
		defaultValue = allowCustomInput ? "" : legacyDefault;
	}

	// Option-list defaults may contain a comma, which is only expressible as a
	// quoted value (|default:"a, b"); unwrap it so it matches its now-unquoted
	// option in both the preflight form and the runtime empty-submission fallback.
	if (hasOptions && defaultValue) {
		defaultValue = unwrapQuotedValue(defaultValue);
	}

	const tokenDisplay = `{{VALUE:${raw}}}`;
	const inputTypeOverride = resolveInputType(
		options.inputTypeOverride,
		{
			tokenDisplay,
			hasOptions,
			allowCustomInput,
		},
		quiet,
	);
	const numericInput = resolveNumericInput(
		options,
		tokenDisplay,
		inputTypeOverride,
		quiet,
	);
	let displayValues: string[] | undefined;

	if (options.displayValuesRaw !== undefined) {
		if (!hasOptions) {
			throw new Error(
				`QuickAdd: VALUE option "text" is only supported for option-list tokens in "${tokenDisplay}".`,
			);
		}

		displayValues = splitQuotedCommaList(options.displayValuesRaw)
			.map((value) => value.trim())
			.filter(Boolean);

		if (displayValues.length !== suggestedValues.length) {
			throw new Error(
				`QuickAdd: VALUE token "${tokenDisplay}" must define the same number of text entries and item entries. To include a comma inside one entry, wrap it in double quotes, e.g. "a, b".`,
			);
		}

		if (new Set(displayValues).size !== displayValues.length) {
			throw new Error(
				`QuickAdd: VALUE token "${tokenDisplay}" has duplicate text entries. Text entries must be unique.`,
			);
		}
	}

	let aliasName = options.name?.trim() || undefined;
	if (aliasName && aliasName.includes(VALUE_LABEL_KEY_DELIMITER)) {
		// The delimiter is reserved for label-scoped keys; an alias containing it
		// would corrupt resolveExistingVariableKey's base-name stripping.
		if (!quiet)
			log.logWarning(
				`QuickAdd: |name in "${tokenDisplay}" contains a reserved control character and was ignored.`,
			);
		aliasName = undefined;
	}
	if (aliasName && RESERVED_VALUE_NAMES.has(aliasName.toLowerCase())) {
		if (!quiet)
			log.logWarning(
				`QuickAdd: |name:${aliasName} is reserved and was ignored in "${tokenDisplay}". Choose a different name.`,
			);
		aliasName = undefined;
	}
	if (aliasName && !hasOptions && !quiet) {
		// A named single value is just a renamed prompt; the option list is what
		// makes |name useful. Honor it but steer authors to the simpler form.
		log.logWarning(
			`QuickAdd: |name on a single value in "${tokenDisplay}" is redundant — use {{VALUE:${aliasName}}} directly.`,
		);
	}

	// |multi needs an option list and is incompatible with |case (a list is not
	// case-transformed, and routing an array through transformCase would throw).
	if (multiSelect && !hasOptions) {
		if (!quiet)
			log.logWarning(
				`QuickAdd: |multi needs an option list (2+ comma-separated values) in "${tokenDisplay}"; ignoring.`,
			);
		multiSelect = false;
	}
	if (multiSelect && caseStyle) {
		if (!quiet)
			log.logWarning(
				`QuickAdd: |case is ignored with |multi in "${tokenDisplay}" — a list is not case-transformed.`,
			);
		caseStyle = undefined;
	}

	const variableKey = aliasName
		? aliasName
		: buildValueVariableKey(variablePart, label, hasOptions);

	return {
		raw,
		variableName: variablePart,
		aliasName,
		variableKey,
		label,
		caseStyle,
		defaultValue,
		allowCustomInput,
		suggestedValues,
		displayValues,
		hasOptions,
		inputTypeOverride: numericInput.inputTypeOverride,
		numericConfig: numericInput.numericConfig,
		sliderConfig: numericInput.sliderConfig,
		optional,
		trim,
		multiSelect,
		multiEmit,
	};
}

export function parseAnonymousValueOptions(
	rawOptions: string,
): {
	label?: string;
	caseStyle?: string;
	defaultValue: string;
	inputTypeOverride?: ValueInputType;
	numericConfig?: NumericInputConfig;
	sliderConfig?: SliderConfig;
	optional: boolean;
	trim: boolean;
} {
	const normalized = stripLeadingPipe(rawOptions);
	const allParts = splitPipeParts(normalized)
		.map((part) => part.trim())
		.filter(Boolean);

	const {
		remaining: parts,
		optional: bareOptional,
		trim: bareTrim,
	} = extractBareValueFlags(allParts);

	if (parts.length === 0) {
		return { defaultValue: "", optional: bareOptional, trim: bareTrim };
	}

	const options = parseOptions(parts, false, false);
	const tokenDisplay = `{{VALUE${rawOptions}}}`;
	if (options.displayValuesRaw !== undefined) {
		throw new Error(
			`QuickAdd: VALUE option "text" is only supported for option-list tokens in "${tokenDisplay}".`,
		);
	}
	let { label, caseStyle, defaultValue } = options;
	if (!options.usesOptions) {
		defaultValue = defaultValue.trim();
	}

	const inputTypeOverride = resolveInputType(options.inputTypeOverride, {
		tokenDisplay,
		hasOptions: false,
		allowCustomInput: options.allowCustomInput,
	});
	const numericInput = resolveNumericInput(
		options,
		tokenDisplay,
		inputTypeOverride,
		false,
	);

	return {
		label,
		caseStyle,
		defaultValue,
		inputTypeOverride: numericInput.inputTypeOverride,
		numericConfig: numericInput.numericConfig,
		sliderConfig: numericInput.sliderConfig,
		optional: options.optionalExplicit ?? bareOptional,
		trim: options.trimExplicit ?? bareTrim,
	};
}
