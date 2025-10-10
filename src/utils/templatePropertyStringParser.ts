const OPEN_TO_CLOSE: Record<string, string> = {
	"[": "]",
	"(": ")",
	"{": "}",
	"<": ">",
};

function splitTopLevel(value: string, delimiter = ","): string[] {
	const segments: string[] = [];
	let current = "";
	const stack: string[] = [];
	let quote: string | null = null;
	let prev = "";

	for (let i = 0; i < value.length; i++) {
		const char = value[i];

		if (quote) {
			current += char;
			if (char === quote && prev !== "\\") {
				quote = null;
			}
			prev = char;
			continue;
		}

		if (char === '"' || char === "'") {
			quote = char;
			current += char;
			prev = char;
			continue;
		}

		if (char in OPEN_TO_CLOSE) {
			stack.push(OPEN_TO_CLOSE[char]);
			current += char;
			prev = char;
			continue;
		}

		if (stack.length > 0) {
			const expectedCloser = stack[stack.length - 1];
			if (char === expectedCloser) {
				stack.pop();
			}
			current += char;
			prev = char;
			continue;
		}

		if (char === delimiter) {
			const trimmed = current.trim();
			if (trimmed.length > 0) segments.push(trimmed);
			current = "";
			prev = char;
			continue;
		}

		current += char;
		prev = char;
	}

	const trimmed = current.trim();
	if (trimmed.length > 0) segments.push(trimmed);

	return segments;
}

function normalizeNewlines(input: string): string {
	if (input.includes("\n")) {
		return input.replace(/\r?\n/g, "\n");
	}

	if (input.includes("\\n")) {
		// Users often type literal "\n" when trying to express multi-line values
		return input.replace(/\\n/g, "\n");
	}

	return input;
}

export function parseStructuredPropertyValueFromString(value: string): unknown | null {
	const trimmed = value.trim();
	if (!trimmed) return null;

	const normalized = normalizeNewlines(trimmed);

	// YAML-style bullet list
	const lines = normalized.split(/\n/);
	const nonEmptyLines = lines.map((line) => line.trim()).filter((line) => line.length > 0);

	if (
		nonEmptyLines.length > 0 &&
		nonEmptyLines.every((line) => /^-\s+/.test(line))
	) {
		return nonEmptyLines.map((line) => line.replace(/^-[\s]*/, "").trim());
	}

	// JSON arrays or objects
	if (
		(normalized.startsWith("[") && normalized.endsWith("]")) ||
		(normalized.startsWith("{") && normalized.endsWith("}"))
	) {
		try {
			return JSON.parse(normalized);
		} catch {
			// Fall through to other parsing strategies
		}
	}

	// Comma-separated values at top level
	if (normalized.includes(",")) {
		const segments = splitTopLevel(normalized);
		if (segments.length > 1) {
			return segments;
		}
	}

	return null;
}

export { splitTopLevel };
