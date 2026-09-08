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
