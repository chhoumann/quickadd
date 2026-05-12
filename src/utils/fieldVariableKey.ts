const FIELD_VARIABLE_PREFIX = "FIELD:";

export function getFieldVariableKey(fieldSpecifier: string): string {
	return `${FIELD_VARIABLE_PREFIX}${fieldSpecifier}`;
}

export function stripFieldVariableKeyPrefix(fieldInput: string): string {
	return fieldInput.startsWith(FIELD_VARIABLE_PREFIX)
		? fieldInput.slice(FIELD_VARIABLE_PREFIX.length)
		: fieldInput;
}
