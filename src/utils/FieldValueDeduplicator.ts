export interface DeduplicationResult {
	values: string[];
	duplicatesRemoved: number;
}

export class FieldValueDeduplicator {
	static deduplicate(values: string[], caseSensitive = false): DeduplicationResult {
		const seen = new Map<string, string>();
		for (const value of values) {
			const key = caseSensitive
				? value
				: value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
			if (!seen.has(key)) seen.set(key, value);
		}

		const deduplicated = Array.from(seen.values());
		deduplicated.sort((a, b) =>
			caseSensitive
				? a.localeCompare(b)
				: a.toLowerCase().localeCompare(b.toLowerCase()),
		);

		return {
			values: deduplicated,
			duplicatesRemoved: values.length - deduplicated.length,
		};
	}
}
