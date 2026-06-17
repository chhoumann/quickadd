const MULTI_SELECT_VALUES_PREFIX = "__quickadd_multi_select_values__:";

export function encodeMultiSelectValues(values: string[]): string {
	return `${MULTI_SELECT_VALUES_PREFIX}${JSON.stringify(values)}`;
}

export function decodeMultiSelectValues(value: string): string[] | null {
	if (!value.startsWith(MULTI_SELECT_VALUES_PREFIX)) return null;

	try {
		const parsed = JSON.parse(value.slice(MULTI_SELECT_VALUES_PREFIX.length));
		if (!Array.isArray(parsed)) return null;
		return parsed.filter((item): item is string => typeof item === "string");
	} catch {
		return null;
	}
}
