/** Non-array values that may still carry data must survive editor writes. */
export function isUnreadableList(value: unknown): boolean {
	if (Array.isArray(value) || value == null) return false;
	return typeof value === "object" ? Object.keys(value).length > 0 : Boolean(value);
}
