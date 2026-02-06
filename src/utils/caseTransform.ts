export type CaseStyle =
	| "kebab"
	| "snake"
	| "camel"
	| "pascal"
	| "title"
	| "lower"
	| "upper";

function normalizeStyle(style?: string): CaseStyle | null {
	if (!style) return null;
	const normalized = style.trim().toLowerCase();
	switch (normalized) {
		case "kebab":
		case "snake":
		case "camel":
		case "pascal":
		case "title":
		case "lower":
		case "upper":
			return normalized;
		default:
			return null;
	}
}

function upperFirstLowerRest(word: string): string {
	if (!word) return word;
	const lower = word.toLowerCase();
	return lower.slice(0, 1).toUpperCase() + lower.slice(1);
}

function splitWords(input: string): string[] {
	let s = input;

	// Handle common camel/pascal boundaries (including acronyms like XMLHttp -> XML Http).
	s = s.replace(/([\p{Lu}]+)([\p{Lu}][\p{Ll}])/gu, "$1 $2");
	s = s.replace(/([\p{Ll}\p{N}])([\p{Lu}])/gu, "$1 $2");

	// Split letter <-> number boundaries (Blog2Post -> Blog 2 Post).
	s = s.replace(/([\p{L}])([\p{N}])/gu, "$1 $2");
	s = s.replace(/([\p{N}])([\p{L}])/gu, "$1 $2");

	// Treat any non-letter/non-number as separators. Keep combining marks with letters.
	s = s.replace(/[^\p{L}\p{N}\p{M}]+/gu, " ");

	return s
		.trim()
		.split(/\s+/u)
		.map((w) => w.trim())
		.filter(Boolean);
}

export function transformCase(input: string, style?: string): string {
	const normalized = normalizeStyle(style);
	if (!normalized) return input;

	if (normalized === "lower") return input.toLowerCase();
	if (normalized === "upper") return input.toUpperCase();

	const words = splitWords(input);
	if (words.length === 0) return "";

	switch (normalized) {
		case "kebab":
			return words.map((w) => w.toLowerCase()).join("-");
		case "snake":
			return words.map((w) => w.toLowerCase()).join("_");
		case "camel": {
			const [first, ...rest] = words;
			return [
				first?.toLowerCase() ?? "",
				...rest.map((w) => upperFirstLowerRest(w)),
			].join("");
		}
		case "pascal":
			return words.map((w) => upperFirstLowerRest(w)).join("");
		case "title":
			return words.map((w) => upperFirstLowerRest(w)).join(" ");
		default:
			return input;
	}
}

