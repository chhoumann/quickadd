export const DATE_TOKEN_PREFIX = "@date:";

export function isDateToken(value: unknown): value is string {
	return typeof value === "string" && value.startsWith(DATE_TOKEN_PREFIX);
}

export function encodeDateToken(iso: string): string {
	return `${DATE_TOKEN_PREFIX}${iso}`;
}

export function decodeDateToken(value: unknown): string | null {
	return isDateToken(value) ? value.slice(DATE_TOKEN_PREFIX.length) : null;
}

export function defaultDateVariableFormat(withTime: boolean): string {
	return withTime ? "YYYY-MM-DD HH:mm" : "YYYY-MM-DD";
}
