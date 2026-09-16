import { parseOptions, extractBareValueFlags } from "./valueOptions";
import { resolveNumericInput } from "./valueNumeric";
import { splitQuotedCommaList, unwrapQuotedValue } from "./valueQuotedList";
export { normalizeNumericValue, normalizeSliderValue } from "./valueNumeric";
export { splitQuotedCommaList, unwrapQuotedValue } from "./valueQuotedList";
import { splitPipeParts, stripLeadingPipe } from "./pipeSyntax";
import { isSupportedCaseStyle, SUPPORTED_CASE_STYLES } from "./caseTransform";
import type { MultiValueFormat } from "./multiValueFormat";
import { NOTICE_WARN, type WarnSink } from "./warnSink";

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

export type MultiEmit = "text" | "linklist";

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
	/** Explicit output shape for a multi-select; auto preserves legacy behavior. */
	multiFormat: MultiValueFormat;
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

function resolveCaseStyle(
	caseStyle: string | undefined,
	tokenDisplay: string,
	warn: WarnSink,
): string | undefined {
	if (caseStyle && !isSupportedCaseStyle(caseStyle)) {
		warn(
			`QuickAdd: Unsupported |case style "${caseStyle}" in token "${tokenDisplay}". Supported styles: ${SUPPORTED_CASE_STYLES.join(", ")}.`,
		);
		return undefined;
	}
	return caseStyle;
}

function resolveInputType(
	rawType: string | undefined,
	{
		tokenDisplay,
		hasOptions,
		allowCustomInput,
	}: { tokenDisplay: string; hasOptions: boolean; allowCustomInput: boolean },
	warn: WarnSink,
): ValueInputType | undefined {
	if (!rawType) return undefined;
	const raw = rawType.trim().toLowerCase();
	// `boolean` is a friendly alias for the checkbox true/false picker.
	const normalized = (raw === "boolean" ? "checkbox" : raw) as ValueInputType;
	if (!OPTION_INCOMPATIBLE_TYPES.has(normalized)) {
		warn(
			`QuickAdd: Unsupported VALUE type "${rawType}" in token "${tokenDisplay}". Supported types: multiline, number, slider, checkbox, text.`,
		);
		return undefined;
	}
	if (hasOptions || allowCustomInput) {
		warn(
			`QuickAdd: Ignoring type:${normalized} for option-list VALUE token "${tokenDisplay}".`,
		);
		return undefined;
	}
	return normalized;
}

export function parseValueToken(
	raw: string,
	opts?: { warn?: WarnSink },
): ParsedValueToken | null {
	if (!raw) return null;
	const warn = opts?.warn ?? NOTICE_WARN;

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
	const tokenDisplay = `{{VALUE:${raw}}}`;
	const options = parseOptions(optionParts, hasOptions, true, tokenDisplay, warn);
	let { label, caseStyle, defaultValue, allowCustomInput } = options;
	let multiSelect = options.multiSelect ?? false;
	const multiEmit: MultiEmit = options.multiEmit ?? "text";
	let multiFormat: MultiValueFormat = options.multiFormat ?? "auto";
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

	const inputTypeOverride = resolveInputType(
		options.inputTypeOverride,
		{
			tokenDisplay,
			hasOptions,
			allowCustomInput,
		},
		warn,
	);
	const numericInput = resolveNumericInput(
		options,
		tokenDisplay,
		inputTypeOverride,
		warn,
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
		warn(
			`QuickAdd: |name in "${tokenDisplay}" contains a reserved control character and was ignored.`,
		);
		aliasName = undefined;
	}
	if (aliasName && RESERVED_VALUE_NAMES.has(aliasName.toLowerCase())) {
		warn(
			`QuickAdd: |name:${aliasName} is reserved and was ignored in "${tokenDisplay}". Choose a different name.`,
		);
		aliasName = undefined;
	}
	if (aliasName && !hasOptions) {
		// A named single value is just a renamed prompt; the option list is what
		// makes |name useful. Honor it but steer authors to the simpler form.
		warn(
			`QuickAdd: |name on a single value in "${tokenDisplay}" is redundant — use {{VALUE:${aliasName}}} directly.`,
		);
	}

	// An unrecognized |case: style (e.g. a typo like "keb" or "uppercase") is
	// silently passed through unchanged by transformCase at render time, so warn
	// here — mirroring the |type: unsupported-value warning — so the author sees
	// their mistake instead of debugging an untransformed value.
	caseStyle = resolveCaseStyle(caseStyle, tokenDisplay, warn);

	// |multi needs an option list and is incompatible with |case (a list is not
	// case-transformed, and routing an array through transformCase would throw).
	if (multiSelect && !hasOptions) {
		warn(
			`QuickAdd: |multi needs an option list (2+ comma-separated values) in "${tokenDisplay}"; ignoring.`,
		);
		multiSelect = false;
	}
	if (multiSelect && caseStyle) {
		warn(
			`QuickAdd: |case is ignored with |multi in "${tokenDisplay}" — a list is not case-transformed.`,
		);
		caseStyle = undefined;
	}
	// Warn on ANY explicit |format: without |multi - including |format:auto,
	// which is a no-op the author probably didn't intend.
	if (!multiSelect && options.multiFormat !== undefined) {
		warn(
			`QuickAdd: |format: needs |multi in "${tokenDisplay}"; ignoring.`,
		);
		multiFormat = "auto";
	}

	// A bare `|custom` only enables free-text-with-autocomplete on an option-list
	// token (2+ values). On a single value it falls through to being parsed as the
	// literal default text "custom", silently pre-filling the prompt with that
	// word. Warn (mirroring "|multi needs an option list") so the author isn't
	// surprised, and drop the bogus default so the prompt opens empty.
	if (
		!hasOptions &&
		!options.usesOptions &&
		optionParts.some((part) => part.trim().toLowerCase() === "custom")
	) {
		warn(
			`QuickAdd: |custom needs an option list (2+ comma-separated values) in "${tokenDisplay}"; ignoring.`,
		);
		if (defaultValue.toLowerCase() === "custom") defaultValue = "";
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
		multiFormat,
	};
}

export function parseAnonymousValueOptions(
	rawOptions: string,
	opts?: { warn?: WarnSink },
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
	const warn = opts?.warn ?? NOTICE_WARN;
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

	const tokenDisplay = `{{VALUE${rawOptions}}}`;
	const options = parseOptions(parts, false, false, tokenDisplay, warn);
	if (options.displayValuesRaw !== undefined) {
		throw new Error(
			`QuickAdd: VALUE option "text" is only supported for option-list tokens in "${tokenDisplay}".`,
		);
	}
	let { label, caseStyle, defaultValue } = options;
	if (!options.usesOptions) {
		defaultValue = defaultValue.trim();
	}

	// Warn on an unrecognized |case style (typo) so the anonymous form gets the
	// same feedback as the named/single form (parseValueToken). Routed through
	// the caller's sink so the prompt-context pre-pass (which also calls this)
	// does not double the notice.
	caseStyle = resolveCaseStyle(caseStyle, tokenDisplay, warn);

	const inputTypeOverride = resolveInputType(
		options.inputTypeOverride,
		{
			tokenDisplay,
			hasOptions: false,
			allowCustomInput: options.allowCustomInput,
		},
		warn,
	);
	const numericInput = resolveNumericInput(
		options,
		tokenDisplay,
		inputTypeOverride,
		warn,
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
