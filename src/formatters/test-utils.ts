/**
 * Shared test utilities for Formatter test implementations.
 * Provides common variable resolution logic to avoid duplication across test files.
 */

/**
 * Resolves a variable value, checking both the exact name and base name (without @hints).
 * This mirrors the production Formatter's getResolvedVariableValue behavior.
 */
export function getResolvedVariableValue(
	variables: Map<string, unknown>,
	name: string,
): unknown {
	if (variables.has(name)) return variables.get(name);
	const atIndex = name.indexOf("@");
	if (atIndex !== -1) {
		const base = name.substring(0, atIndex);
		if (variables.has(base)) return variables.get(base);
	}
	return undefined;
}

/**
 * Gets a variable value as a string, returning empty string for null/undefined.
 * Non-string values are converted via toString().
 */
export function getVariableValueAsString(
	variables: Map<string, unknown>,
	name: string,
): string {
	const value = getResolvedVariableValue(variables, name);
	if (value === undefined || value === null) return "";
	return typeof value === "string" ? value : value.toString();
}

/**
 * Returns true when a variable is present AND its value is neither undefined nor null.
 * An empty string is considered a valid, intentional value.
 */
export function hasConcreteVariable(
	variables: Map<string, unknown>,
	name: string,
): boolean {
	const value = getResolvedVariableValue(variables, name);
	return value !== undefined && value !== null;
}
