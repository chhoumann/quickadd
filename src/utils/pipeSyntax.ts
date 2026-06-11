export function splitPipeParts(input: string): string[] {
	// `String.prototype.split` preserves empty segments, including trailing ones.
	return input.split("|");
}

export function stripLeadingPipe(input: string): string {
	if (!input.startsWith("|")) return input;
	return input.slice(1);
}

export function parsePipeKeyValue(
	part: string,
): { key: string; value: string } | null {
	const colonIndex = part.indexOf(":");
	if (colonIndex === -1) return null;

	const key = part.slice(0, colonIndex).trim().toLowerCase();
	if (!key) return null;

	const value = part.slice(colonIndex + 1).trim();
	return { key, value };
}

export function parseBooleanFlag(value?: string): boolean {
	if (!value) return true;
	const normalized = value.trim().toLowerCase();
	if (["false", "no", "0", "off"].includes(normalized)) return false;
	return true;
}

/**
 * Pulls bare flag parts (an entire pipe part equal to the flag word, trimmed,
 * case-insensitive) out of a pipe-part list. Shared by the VALUE and VDATE
 * grammars so the `optional` flag word means the same thing in both.
 */
export function extractBareFlagPart(
	parts: string[],
	flag: string,
): { remaining: string[]; found: boolean } {
	let found = false;
	const remaining = parts.filter((part) => {
		if (part.trim().toLowerCase() === flag) {
			found = true;
			return false;
		}
		return true;
	});
	return { remaining, found };
}

