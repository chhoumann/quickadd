import type { App } from "obsidian";

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

	for (let i = 0; i < value.length; i++) {
		const char = value[i];

		if (quote) {
			current += char;
			if (char === quote) {
				let backslashCount = 0;
				for (let j = i - 1; j >= 0 && value[j] === "\\"; j--) {
					backslashCount++;
				}
				if (backslashCount % 2 === 0) {
					quote = null;
				}
			}
			continue;
		}

		if (char === '"' || char === "'") {
			quote = char;
			current += char;
			continue;
		}

		if (char in OPEN_TO_CLOSE) {
			stack.push(OPEN_TO_CLOSE[char]);
			current += char;
			continue;
		}

		if (stack.length > 0) {
			const expectedCloser = stack[stack.length - 1];
			if (char === expectedCloser) {
				stack.pop();
			}
			current += char;
			continue;
		}

		if (char === delimiter) {
			const trimmed = current.trim();
			if (trimmed.length > 0) segments.push(trimmed);
			current = "";
			continue;
		}

		current += char;
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

export interface ParseOptions {
	propertyKey?: string;
	app?: App;
	propertyType?: string | null;
}

function resolvePropertyType(app: App | undefined, propertyKey: string | undefined): string | null {
	if (!app || !propertyKey) return null;
	const metadataCache = (app as unknown as { metadataCache?: unknown }).metadataCache as
		| { app?: { metadataTypeManager?: { getTypeInfo?: (key: string) => unknown } } }
		| undefined;
	const metadataTypeManager =
		(app as unknown as { metadataTypeManager?: { getTypeInfo?: (key: string) => unknown } })
			.metadataTypeManager ?? metadataCache?.app?.metadataTypeManager;
	if (!metadataTypeManager || typeof metadataTypeManager.getTypeInfo !== "function") {
		return null;
	}
	const info = metadataTypeManager.getTypeInfo(propertyKey) as
		| {
				expected?: { type?: string } | null;
				inferred?: { type?: string } | null;
			}
		| undefined;
	const type = info?.expected?.type ?? info?.inferred?.type;
	return typeof type === "string" ? type : null;
}

function supportsCommaList(propertyType: string | null): boolean {
	if (!propertyType) return false;
	const normalized = propertyType.toLowerCase();
	return normalized === "list" || normalized === "tags" || normalized === "multitext";
}

export function parseStructuredPropertyValueFromString(
	value: string,
	options?: ParseOptions,
): unknown | undefined {
	const trimmed = value.trim();
	if (!trimmed) return undefined;

	const normalized = normalizeNewlines(trimmed);
	const propertyType = options?.propertyType ?? resolvePropertyType(options?.app, options?.propertyKey);
	const explicitMultiValue = supportsCommaList(propertyType);
	const allowHeuristicMultiValue = propertyType === null;
	const allowMultiValue = explicitMultiValue || allowHeuristicMultiValue;

	// YAML-style bullet list
	const lines = normalized.split(/\n/);
	const nonEmptyLines = lines.map((line) => line.trim()).filter((line) => line.length > 0);

	if (
		allowMultiValue &&
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
		if (propertyType && !explicitMultiValue && propertyType !== "list") {
			return undefined;
		}
		try {
			return JSON.parse(normalized);
		} catch {
			// Fall through to other parsing strategies
		}
	}

	// Comma-separated values at top level (only when property supports multi-value types)
	if (normalized.includes(",") && allowMultiValue) {
		const segments = splitTopLevel(normalized);
		if (segments.length > 1) {
			return segments;
		}
	}

	return undefined;
}

export { splitTopLevel };
