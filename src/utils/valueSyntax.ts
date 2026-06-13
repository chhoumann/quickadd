import {
	extractBareFlagPart,
	parseBooleanFlag,
	parsePipeKeyValue,
	splitPipeParts,
	stripLeadingPipe,
} from "./pipeSyntax";

// Internal-only delimiter for scoping labeled VALUE lists. Unlikely to appear in user input.
export const VALUE_LABEL_KEY_DELIMITER = "\u001F";

export type ValueInputType = "multiline";

const VALUE_OPTION_KEYS = new Set([
	"label",
	"default",
	"custom",
	"type",
	"case",
	"text",
	"optional",
]);

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
	optional: boolean;
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
	displayValuesRaw?: string;
	optionalExplicit?: boolean;
	name?: string;
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

function hasRecognizedOption(part: string, allowName: boolean): boolean {
	const trimmed = part.trim();
	if (!trimmed) return false;
	const parsed = parsePipeKeyValue(trimmed);
	if (!parsed) return false;
	const keys = allowName ? NAMED_VALUE_OPTION_KEYS : VALUE_OPTION_KEYS;
	return keys.has(parsed.key);
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
	const hasExplicitOption = optionParts.some((part) =>
		hasRecognizedOption(part, allowName),
	);
	const hasCustomFlag =
		hasOptions &&
		optionParts.some(
			(part) => part.trim().toLowerCase() === "custom",
		);
	const usesOptions = hasExplicitOption || hasCustomFlag;

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
	let displayValuesRaw: string | undefined;
	let optionalExplicit: boolean | undefined;
	let name: string | undefined;

	for (const part of optionParts) {
		const trimmed = part.trim();
		if (!trimmed) continue;

		if (hasOptions && trimmed.toLowerCase() === "custom") {
			allowCustomInput = true;
			continue;
		}

		const parsed = parsePipeKeyValue(trimmed);
		if (!parsed) continue;
		const { key, value } = parsed;
		if (!optionKeys.has(key)) continue;

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
			case "text":
				displayValuesRaw = value;
				break;
			case "optional":
				optionalExplicit = parseBooleanFlag(value);
				break;
			case "name":
				// Gated to the named grammar via optionKeys; empty `|name:` is a
				// no-op alias and warns so the author notices the typo.
				if (value) name = value;
				else if (!quiet)
					console.warn(
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
		displayValuesRaw,
		optionalExplicit,
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
	const normalized = rawType.trim().toLowerCase();
	if (normalized !== "multiline") {
		if (!quiet)
			console.warn(
				`QuickAdd: Unsupported VALUE type "${rawType}" in token "${tokenDisplay}". Supported types: multiline.`,
			);
		return undefined;
	}
	if (hasOptions || allowCustomInput) {
		if (!quiet)
			console.warn(
				`QuickAdd: Ignoring type:multiline for option-list VALUE token "${tokenDisplay}".`,
			);
		return undefined;
	}
	return "multiline";
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

	const suggestedValues = variablePart
		.split(",")
		.map((value) => value.trim())
		.filter(Boolean);
	const hasOptions = suggestedValues.length > 1;

	const { remaining: optionParts, optional: bareOptional } =
		extractBareOptionalFlag(parts);
	const options = parseOptions(optionParts, hasOptions, true, quiet);
	let { label, caseStyle, defaultValue, allowCustomInput } = options;
	const optional = options.optionalExplicit ?? bareOptional;

	if (!options.usesOptions) {
		const legacyDefault = defaultValue;
		allowCustomInput = hasOptions && legacyDefault.toLowerCase() === "custom";
		defaultValue = allowCustomInput ? "" : legacyDefault;
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
	let displayValues: string[] | undefined;

	if (options.displayValuesRaw !== undefined) {
		if (!hasOptions) {
			throw new Error(
				`QuickAdd: VALUE option "text" is only supported for option-list tokens in "${tokenDisplay}".`,
			);
		}

		displayValues = options.displayValuesRaw
			.split(",")
			.map((value) => value.trim())
			.filter(Boolean);

		if (displayValues.length !== suggestedValues.length) {
			throw new Error(
				`QuickAdd: VALUE token "${tokenDisplay}" must define the same number of text entries and item entries.`,
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
			console.warn(
				`QuickAdd: |name in "${tokenDisplay}" contains a reserved control character and was ignored.`,
			);
		aliasName = undefined;
	}
	if (aliasName && RESERVED_VALUE_NAMES.has(aliasName.toLowerCase())) {
		if (!quiet)
			console.warn(
				`QuickAdd: |name:${aliasName} is reserved and was ignored in "${tokenDisplay}". Choose a different name.`,
			);
		aliasName = undefined;
	}
	if (aliasName && !hasOptions && !quiet) {
		// A named single value is just a renamed prompt; the option list is what
		// makes |name useful. Honor it but steer authors to the simpler form.
		console.warn(
			`QuickAdd: |name on a single value in "${tokenDisplay}" is redundant — use {{VALUE:${aliasName}}} directly.`,
		);
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
		inputTypeOverride,
		optional,
	};
}

export function parseAnonymousValueOptions(
	rawOptions: string,
): {
	label?: string;
	caseStyle?: string;
	defaultValue: string;
	inputTypeOverride?: ValueInputType;
	optional: boolean;
} {
	const normalized = stripLeadingPipe(rawOptions);
	const allParts = splitPipeParts(normalized)
		.map((part) => part.trim())
		.filter(Boolean);

	const { remaining: parts, optional: bareOptional } =
		extractBareOptionalFlag(allParts);

	if (parts.length === 0) {
		return { defaultValue: "", optional: bareOptional };
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

	return {
		label,
		caseStyle,
		defaultValue,
		inputTypeOverride,
		optional: options.optionalExplicit ?? bareOptional,
	};
}
