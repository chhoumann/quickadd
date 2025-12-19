// Internal-only delimiter for scoping labeled VALUE lists. Unlikely to appear in user input.
export const VALUE_LABEL_KEY_DELIMITER = "\u001F";

const VALUE_OPTION_KEYS = new Set(["label", "default", "custom"]);

export type ParsedValueToken = {
	raw: string;
	variableName: string;
	variableKey: string;
	label?: string;
	defaultValue: string;
	allowCustomInput: boolean;
	suggestedValues: string[];
	hasOptions: boolean;
};

type ParsedOptions = {
	label?: string;
	defaultValue: string;
	allowCustomInput: boolean;
	usesOptions: boolean;
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
			default:
				break;
		}
	}

	return {
		label,
		defaultValue,
		allowCustomInput,
		usesOptions: true,
	};
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

	const variableKey =
		hasOptions && label
			? `${variablePart}${VALUE_LABEL_KEY_DELIMITER}${label}`
			: variablePart;

	return {
		raw,
		variableName: variablePart,
		variableKey,
		label,
		defaultValue,
		allowCustomInput,
		suggestedValues,
		hasOptions,
	};
}
