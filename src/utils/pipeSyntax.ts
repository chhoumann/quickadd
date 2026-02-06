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

