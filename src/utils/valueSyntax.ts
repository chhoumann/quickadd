export const VALUE_LABEL_DELIMITER = "::";

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

type LabelSplit = {
	variableName: string;
	label?: string;
};

function splitLabel(raw: string): LabelSplit {
	const trimmed = raw.trim();
	if (!trimmed) return { variableName: "" };

	const doubleColonIndex = trimmed.indexOf(VALUE_LABEL_DELIMITER);
	if (doubleColonIndex !== -1) {
		const variableName = trimmed.slice(0, doubleColonIndex).trim();
		const label = trimmed.slice(doubleColonIndex + VALUE_LABEL_DELIMITER.length).trim();
		if (label) return { variableName, label };
		return { variableName };
	}

	// Support legacy shorthand for single-value labels, but avoid tags/options lists.
	if (!trimmed.includes(",") && !trimmed.startsWith("#")) {
		const hashIndex = trimmed.indexOf("#");
		if (hashIndex > 0) {
			const variableName = trimmed.slice(0, hashIndex).trim();
			const label = trimmed.slice(hashIndex + 1).trim();
			if (label) return { variableName, label };
		}
	}

	return { variableName: trimmed };
}

export function parseValueToken(raw: string): ParsedValueToken | null {
	if (!raw) return null;

	const pipeIndex = raw.indexOf("|");
	const variablePart = pipeIndex === -1 ? raw : raw.slice(0, pipeIndex);
	const rawDefaultValue = pipeIndex === -1 ? "" : raw.slice(pipeIndex + 1).trim();

	const { variableName, label } = splitLabel(variablePart);
	if (!variableName) return null;

	const suggestedValues = variableName
		.split(",")
		.map((value) => value.trim())
		.filter(Boolean);
	const hasOptions = suggestedValues.length > 1;

	const allowCustomInput =
		hasOptions && rawDefaultValue.toLowerCase() === "custom";
	const defaultValue = allowCustomInput ? "" : rawDefaultValue;

	const variableKey =
		hasOptions && label
			? `${variableName}${VALUE_LABEL_DELIMITER}${label}`
			: variableName;

	return {
		raw,
		variableName,
		variableKey,
		label,
		defaultValue,
		allowCustomInput,
		suggestedValues,
		hasOptions,
	};
}
