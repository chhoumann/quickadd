import { parseAnonymousValueOptions, parseValueToken } from "./valueSyntax";

export function untypedPropertyValueVariable(format: string): string | null {
	const named = /^\{\{VALUE:([^{}]+)\}\}$/i.exec(format);
	if (named) {
		const parsed = parseValueToken(named[1]);
		return parsed && !parsed.inputTypeOverride && !parsed.hasOptions && !parsed.caseStyle
			? parsed.variableKey : null;
	}
	const anonymous = /^\{\{(?:VALUE|NAME)(\|[^{}]+)?\}\}$/i.exec(format);
	if (!anonymous) return null;
	const parsed = parseAnonymousValueOptions(anonymous[1] ?? "");
	return !parsed.inputTypeOverride && !parsed.caseStyle ? "value" : null;
}

export function inheritPropertyValueType(format: string, propertyType: string | null): string {
	const type = propertyType === "boolean" ? "checkbox" : propertyType;
	if ((type !== "number" && type !== "checkbox") || untypedPropertyValueVariable(format) === null) {
		return format;
	}
	return `${format.slice(0, -2)}|type:${type}}}`;
}

/**
 * String form of a property's current value for `{{PROPERTY}}` expansion.
 * Lists become one item per line (so captureListItems round-trips). Items that
 * already contain a line break abort — inventing extra items would be wrong.
 */
export function stringifyPropertyTokenValue(value: unknown): string {
	if (value === undefined || value === null) return "";
	if (Array.isArray(value)) {
		if (!value.every((item): item is string => typeof item === "string")) {
			throw new Error("{{PROPERTY}} only expands lists of text.");
		}
		if (value.some((item) => /[\r\n]/.test(item))) {
			throw new Error(
				"{{PROPERTY}} cannot expand a list item that contains a line break. Return a rewritten array from an inline script instead.",
			);
		}
		return value.join("\n");
	}
	if (typeof value === "string" || typeof value === "boolean") return String(value);
	if (typeof value === "number" && Number.isFinite(value)) return String(value);
	throw new Error("{{PROPERTY}} only expands text, finite numbers, checkboxes, and lists of text.");
}
