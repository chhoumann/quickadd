export function normalizeForSearch(value: string): string {
	return value.normalize("NFC").toLowerCase();
}
