// Internal-only delimiter for scoping labeled VALUE lists. Unlikely to appear in user input.
export const VALUE_LABEL_KEY_DELIMITER = "\u001F";

export type ValueInputType = "multiline";

const VALUE_OPTION_KEYS = new Set(["label", "default", "custom", "type"]);

export type ParsedValueToken = {
	raw: string;
	variableName: string;
	variableKey: string;
	label?: string;
	defaultValue: string;
	allowCustomInput: boolean;
	suggestedValues: string[];
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
	defaultValue: string;
	allowCustomInput: boolean;
	usesOptions: boolean;
	inputTypeOverride?: string;
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
	if (!trimmed.includes(":")) return false;
	const key = trimmed.split(":", 1)[0]?.trim().toLowerCase();
	return !!key && VALUE_OPTION_KEYS.has(key);
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
	let defaultValue = "";
	let allowCustomInput = false;
	let inputTypeOverride: string | undefined;

	for (const part of optionParts) {
		const trimmed = part.trim();
		if (!trimmed) continue;

		if (hasOptions && trimmed.toLowerCase() === "custom") {
			allowCustomInput = true;
			continue;
		}

		const colonIndex = trimmed.indexOf(":");
		if (colonIndex === -1) continue;
		const key = trimmed.slice(0, colonIndex).trim().toLowerCase();
		const value = trimmed.slice(colonIndex + 1).trim();
		if (!VALUE_OPTION_KEYS.has(key)) continue;

		switch (key) {
			case "label":
				if (value) label = value;
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
			default:
				break;
		}
	}

	return {
		label,
		defaultValue,
		allowCustomInput,
		usesOptions: true,
		inputTypeOverride,
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

	const parts = raw.split("|");
	const variablePart = (parts.shift() ?? "").trim();
	if (!variablePart) return null;

	const suggestedValues = variablePart
		.split(",")
		.map((value) => value.trim())
		.filter(Boolean);
	const hasOptions = suggestedValues.length > 1;

	const options = parseOptions(parts, hasOptions);
	let { label, defaultValue, allowCustomInput } = options;

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

	const variableKey = buildValueVariableKey(variablePart, label, hasOptions);

	return {
		raw,
		variableName: variablePart,
		variableKey,
		label,
		defaultValue,
		allowCustomInput,
		suggestedValues,
		hasOptions,
		inputTypeOverride,
	};
}

export function parseAnonymousValueOptions(
	rawOptions: string,
): {
	label?: string;
	defaultValue: string;
	inputTypeOverride?: ValueInputType;
} {
	const normalized = rawOptions.startsWith("|")
		? rawOptions.slice(1)
		: rawOptions;
	const parts = normalized
		.split("|")
		.map((part) => part.trim())
		.filter(Boolean);

	if (parts.length === 0) {
		return { defaultValue: "" };
	}

	const options = parseOptions(parts, false);
	let { label, defaultValue } = options;
	if (!options.usesOptions) {
		defaultValue = defaultValue.trim();
	}

	const tokenDisplay = `{{VALUE${rawOptions}}}`;
	const inputTypeOverride = resolveInputType(options.inputTypeOverride, {
		tokenDisplay,
		hasOptions: false,
		allowCustomInput: options.allowCustomInput,
	});

	return {
		label,
		defaultValue,
		inputTypeOverride,
	};
}
