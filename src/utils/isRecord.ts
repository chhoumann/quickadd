/** Any non-null object, arrays included: a value whose properties can be read. */
export function isRecord(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === "object";
}

/** A non-null, non-array object. */
export function isObjectRecord(value: unknown): value is Record<string, unknown> {
	return isRecord(value) && !Array.isArray(value);
}
