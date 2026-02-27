import { parsePipeKeyValue, splitPipeParts, stripLeadingPipe } from "./pipeSyntax";

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
]);

export type ParsedValueToken = {
	raw: string;
	variableName: string;
	variableKey: string;
	label?: string;
	caseStyle?: string;
	defaultValue: string;
	allowCustomInput: boolean;
	suggestedValues: string[];
	displayValues?: string[];
	hasOptions: boolean;
	inputTypeOverride?: ValueInputType;
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
};

function parseBoolean(value?: string): boolean {
	if (!value) return true;
	const normalized = value.trim().toLowerCase();
	if (["false", "no", "0", "off"].includes(normalized)) return false;
	return true;
}

function hasRecognizedOption(part: string): boolean {
	const trimmed = part.trim();
	if (!trimmed) return false;
	const parsed = parsePipeKeyValue(trimmed);
	if (!parsed) return false;
	return VALUE_OPTION_KEYS.has(parsed.key);
}

function parseOptions(optionParts: string[], hasOptions: boolean): ParsedOptions {
	if (optionParts.length === 0) {
		return {
			defaultValue: "",
			allowCustomInput: false,
			usesOptions: false,
		};
	}

	const hasExplicitOption = optionParts.some(hasRecognizedOption);
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
		if (!VALUE_OPTION_KEYS.has(key)) continue;

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
				allowCustomInput = parseBoolean(value);
				break;
			case "type":
				if (value) inputTypeOverride = value;
				break;
			case "text":
				displayValuesRaw = value;
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
		usesOptions: true,
		inputTypeOverride,
		displayValuesRaw,
	};
}

function resolveInputType(
	rawType: string | undefined,
	{
		tokenDisplay,
		hasOptions,
		allowCustomInput,
	}: { tokenDisplay: string; hasOptions: boolean; allowCustomInput: boolean },
): ValueInputType | undefined {
	if (!rawType) return undefined;
	const normalized = rawType.trim().toLowerCase();
	if (normalized !== "multiline") {
		console.warn(
			`QuickAdd: Unsupported VALUE type "${rawType}" in token "${tokenDisplay}". Supported types: multiline.`,
		);
		return undefined;
	}
	if (hasOptions || allowCustomInput) {
		console.warn(
			`QuickAdd: Ignoring type:multiline for option-list VALUE token "${tokenDisplay}".`,
		);
		return undefined;
	}
	return "multiline";
}

export function parseValueToken(raw: string): ParsedValueToken | null {
	if (!raw) return null;

	const parts = splitPipeParts(raw);
	const variablePart = (parts.shift() ?? "").trim();
	if (!variablePart) return null;

	const suggestedValues = variablePart
		.split(",")
		.map((value) => value.trim())
		.filter(Boolean);
	const hasOptions = suggestedValues.length > 1;

	const options = parseOptions(parts, hasOptions);
	let { label, caseStyle, defaultValue, allowCustomInput } = options;

	if (!options.usesOptions) {
		const legacyDefault = defaultValue;
		allowCustomInput = hasOptions && legacyDefault.toLowerCase() === "custom";
		defaultValue = allowCustomInput ? "" : legacyDefault;
	}

	const tokenDisplay = `{{VALUE:${raw}}}`;
	const inputTypeOverride = resolveInputType(options.inputTypeOverride, {
		tokenDisplay,
		hasOptions,
		allowCustomInput,
	});
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

	const variableKey = buildValueVariableKey(variablePart, label, hasOptions);

	return {
		raw,
		variableName: variablePart,
		variableKey,
		label,
		caseStyle,
		defaultValue,
		allowCustomInput,
		suggestedValues,
		displayValues,
		hasOptions,
		inputTypeOverride,
	};
}

export function parseAnonymousValueOptions(
	rawOptions: string,
): {
	label?: string;
	caseStyle?: string;
	defaultValue: string;
	inputTypeOverride?: ValueInputType;
} {
	const normalized = stripLeadingPipe(rawOptions);
	const parts = splitPipeParts(normalized)
		.map((part) => part.trim())
		.filter(Boolean);

	if (parts.length === 0) {
		return { defaultValue: "" };
	}

	const options = parseOptions(parts, false);
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
	};
}
