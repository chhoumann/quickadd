export type DateAliasMap = Record<string, string>;

export const DEFAULT_DATE_ALIASES: DateAliasMap = {
	t: "today",
	tm: "tomorrow",
	yd: "yesterday",
	nw: "next week",
	nm: "next month",
	ny: "next year",
	lw: "last week",
	lm: "last month",
	ly: "last year",
};

export function normalizeDateInput(
	input: string,
	aliases: DateAliasMap = DEFAULT_DATE_ALIASES,
): string {
	const trimmed = input.trim();
	if (!trimmed) return input;

	const direct = aliases[trimmed.toLowerCase()];
	if (direct) return direct;

	const [first, ...rest] = trimmed.split(/\s+/);
	const replacement = aliases[first.toLowerCase()];
	if (!replacement) return input;

	return [replacement, ...rest].join(" ");
}

export function parseDateAliasLines(text: string): DateAliasMap {
	const result: DateAliasMap = {};
	const lines = text.split(/\r?\n/);

	for (const line of lines) {
		const trimmed = line.trim();
		if (!trimmed || trimmed.startsWith("#")) continue;

		const separatorIndex = trimmed.indexOf("=");
		if (separatorIndex === -1) continue;

		const key = trimmed.slice(0, separatorIndex).trim().toLowerCase();
		const value = trimmed.slice(separatorIndex + 1).trim();

		if (!key || !value) continue;
		result[key] = value;
	}

	return result;
}

export function formatDateAliasLines(aliases: DateAliasMap): string {
	return Object.entries(aliases)
		.filter(([key, value]) => key && value)
		.map(([key, value]) => `${key} = ${value}`)
		.join("\n");
}

export function getOrderedDateAliases(
	aliases: DateAliasMap,
): Array<[string, string]> {
	const entries = Object.entries(aliases);
	if (entries.length === 0) return [];

	const preferredKeys = ["t", "tm", "yd"];
	const preferred = preferredKeys
		.map((key) => {
			const value = aliases[key];
			return value ? ([key, value] as [string, string]) : null;
		})
		.filter((entry): entry is [string, string] => entry !== null);

	const used = new Set(preferred.map(([key]) => key));
	const remaining = entries
		.filter(([key]) => !used.has(key))
		.sort((a, b) => {
			const lenDiff = a[0].length - b[0].length;
			if (lenDiff !== 0) return lenDiff;
			return a[0].localeCompare(b[0]);
		});

	return [...preferred, ...remaining];
}

export function formatDateAliasInline(aliases: DateAliasMap): string {
	return getOrderedDateAliases(aliases)
		.map(([key, value]) => `${key}=${value}`)
		.join(", ");
}
