import { isReservedWindowsDeviceName } from "./pathValidation";

export type CaseStyle =
	| "kebab"
	| "snake"
	| "camel"
	| "pascal"
	| "title"
	| "lower"
	| "upper"
	| "slug";

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
		case "slug":
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

function isAcronym(word: string): boolean {
	// Contains letters, includes uppercase, and includes no lowercase.
	if (!/\p{L}/u.test(word)) return false;
	return /\p{Lu}/u.test(word) && !/\p{Ll}/u.test(word);
}

function isMixedCase(word: string): boolean {
	return /\p{Lu}/u.test(word) && /\p{Ll}/u.test(word);
}

function isLowerLeadingBrandToken(word: string): boolean {
	// Brand-case heuristics: keep tokens like iOS/iPhone/eBay when they lead with lowercase.
	return /^\p{Ll}/u.test(word) && isMixedCase(word);
}

function tokenizeSegment(segment: string): string[] {
	if (!segment) return [];

	// Special-case iOS-like brand tokens: keep them intact.
	// Example: "iOS" -> ["iOS"], "iOS17" -> ["iOS", "17"].
	{
		const match = segment.match(/^([\p{Ll}][\p{Lu}]{2,})([\p{N}]+)?$/u);
		if (match) {
			const out = [match[1]];
			if (match[2]) out.push(match[2]);
			return out;
		}
	}

	// Preserve one-letter brand-case like "iPhone" or "eBay" as a single token.
	if (/^[\p{Ll}][\p{Lu}][\p{Ll}]+(?:[\p{Lu}][\p{Ll}]+)*$/u.test(segment)) {
		return [segment];
	}

	let s = segment;

	// Split typical acronym+word boundaries (XMLHttp -> XML Http).
	s = s.replace(/([\p{Lu}]+)([\p{Lu}][\p{Ll}])/gu, "$1 $2");
	// Split lower/digit -> upper boundaries (myNew -> my New).
	s = s.replace(/([\p{Ll}\p{N}])([\p{Lu}])/gu, "$1 $2");

	// Split letter <-> number boundaries (Blog2Post -> Blog 2 Post).
	s = s.replace(/([\p{L}])([\p{N}])/gu, "$1 $2");
	s = s.replace(/([\p{N}])([\p{L}])/gu, "$1 $2");

	return s
		.trim()
		.split(/\s+/u)
		.map((w) => w.trim())
		.filter(Boolean);
}

function tokenizeWords(input: string): string[] {
	// Treat any non-letter/non-number/non-mark as separators.
	const segments = input.split(/[^\p{L}\p{N}\p{M}]+/gu).filter(Boolean);
	return segments.flatMap(tokenizeSegment).filter(Boolean);
}

export function transformCase(input: string, style?: string): string {
	const normalized = normalizeStyle(style);
	if (!normalized) return input;

	if (normalized === "lower") return input.toLowerCase();
	if (normalized === "upper") return input.toUpperCase();

	const words = tokenizeWords(input);
	if (words.length === 0) return "";

	switch (normalized) {
		case "kebab":
			return words.map((w) => w.toLowerCase()).join("-");
		case "snake":
			return words.map((w) => w.toLowerCase()).join("_");
		case "camel": {
			const [first, ...rest] = words;
			const firstOut = first
				? isLowerLeadingBrandToken(first)
					? first
					: first.toLowerCase()
				: "";
			const restOut = rest.map((word) => {
				if (isAcronym(word) || isMixedCase(word)) return word;
				return upperFirstLowerRest(word);
			});
			return [firstOut, ...restOut].join("");
		}
		case "pascal":
			return words
				.map((word) => {
					if (isAcronym(word) || isMixedCase(word)) return word;
					return upperFirstLowerRest(word);
				})
				.join("");
		case "title":
			return words
				.map((word) => {
					if (isAcronym(word) || isMixedCase(word)) return word;
					return upperFirstLowerRest(word);
				})
				.join(" ");
		case "slug": {
			const slug = words.map((w) => w.toLowerCase()).join("-");
			if (isReservedWindowsDeviceName(slug)) return `${slug}-`;
			return slug;
		}
		default:
			return input;
	}
}
