import { FIELD_VAR_REGEX_WITH_FILTERS } from "../constants";
import type { FieldFilter } from "./FieldSuggestionParser";

interface ProcessedValues {
	values: string[];
	hasDefaultValue: boolean;
	duplicatesRemoved: number;
	totalProcessed: number;
}

export class FieldValueProcessor {
	private static readonly unresolvedFieldTokenRegex = new RegExp(
		`^${FIELD_VAR_REGEX_WITH_FILTERS.source}$`,
		"i",
	);

	static processValues(
		rawValues: Set<string>,
		filters: FieldFilter
	): ProcessedValues {
		const totalProcessed = rawValues.size;
		let values = Array.from(rawValues).filter(
			(value) => !this.isUnresolvedFieldToken(value),
		);

		const deduplicationResult = this.deduplicate(values, filters.caseSensitive);
		values = deduplicationResult.values;

		const { processedValues, hasDefault } = this.applyDefaultValues(values, filters);
		values = processedValues;

		return {
			values,
			hasDefaultValue: hasDefault,
			duplicatesRemoved: deduplicationResult.duplicatesRemoved,
			totalProcessed
		};
	}

	/**
	 * Drops values that repeat an earlier one (under the case and diacritic fold
	 * unless `caseSensitive`), keeping the first spelling, then sorts.
	 */
	static deduplicate(
		values: string[],
		caseSensitive = false,
	): { values: string[]; duplicatesRemoved: number } {
		const seen = new Map<string, string>();
		for (const value of values) {
			const key = caseSensitive ? value : this.normalizeForComparison(value);
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

	private static isUnresolvedFieldToken(value: string): boolean {
		return this.unresolvedFieldTokenRegex.test(value.trim());
	}

	private static applyDefaultValues(
		values: string[],
		filters: FieldFilter
	): { processedValues: string[]; hasDefault: boolean } {
		if (!filters.defaultValue) {
			return { processedValues: values, hasDefault: false };
		}

		const defaultValue = filters.defaultValue;
		let processedValues = [...values];
		let hasDefault = false;

		// Existing values are deduplicated case-insensitively by default, so the
		// default must be compared with the same fold; otherwise a default that
		// differs only by case from an existing value (e.g. default:done vs a
		// collected "Done") is added as a separate, near-identical entry.
		const isPresent = (value: string): boolean =>
			filters.caseSensitive
				? value === defaultValue
				: this.normalizeForComparison(value) ===
					this.normalizeForComparison(defaultValue);

		if (filters.defaultAlways) {
			// Always include default at the beginning, remove if already present
			processedValues = processedValues.filter((v) => !isPresent(v));
			processedValues.unshift(defaultValue);
			hasDefault = true;
		} else if (filters.defaultEmpty && values.length === 0) {
			// Only include default if no values found
			processedValues = [defaultValue];
			hasDefault = true;
		} else if (!filters.defaultEmpty && !filters.defaultAlways) {
			// Default behavior: include if not already present and prepend
			if (!processedValues.some(isPresent)) {
				processedValues.unshift(defaultValue);
				hasDefault = true;
			}
		}

		return { processedValues, hasDefault };
	}

	/**
	 * Promotes `value` to the front of an already-processed list, removing any
	 * entry that matches under the dedup case fold. Used for `default-from:active`,
	 * applied after vault collection so it never perturbs the collection cache
	 * key. The promoted entry keeps the active note's casing.
	 */
	static promoteValueToFront(
		values: string[],
		value: string,
		caseSensitive = false,
	): string[] {
		const isPresent = (candidate: string): boolean =>
			caseSensitive
				? candidate === value
				: this.normalizeForComparison(candidate) ===
					this.normalizeForComparison(value);
		return [value, ...values.filter((candidate) => !isPresent(candidate))];
	}

	/**
	 * The entry in `values` matching `value` under the dedup case fold, or `value`
	 * itself, so an active-note preselection toggles the existing option instead of
	 * adding a case-variant custom row. Unchanged with `caseSensitive`.
	 */
	static canonicalizeAgainst(
		values: string[],
		value: string,
		caseSensitive = false,
	): string {
		if (caseSensitive) return value;
		const normalized = this.normalizeForComparison(value);
		return (
			values.find(
				(candidate) =>
					this.normalizeForComparison(candidate) === normalized,
			) ?? value
		);
	}

	/**
	 * The case-insensitive fold (Unicode NFD + diacritic strip + lowercase) that
	 * deduplication, default matching and promotion all compare under.
	 */
	private static normalizeForComparison(value: string): string {
		return value
			.normalize("NFD")
			.replace(/[\u0300-\u036f]/g, "")
			.toLowerCase();
	}

	static getSmartDefaults(
		fieldName: string,
		existingValues: string[]
	): string[] {
		const commonDefaults: Record<string, string[]> = {
			status: ["To Do", "In Progress", "Done", "Cancelled"],
			priority: ["High", "Medium", "Low"],
			type: ["Note", "Task", "Project", "Reference"],
			category: ["Personal", "Work", "Study"],
			mood: ["😊 Good", "😐 Neutral", "😔 Bad"],
			rating: ["⭐", "⭐⭐", "⭐⭐⭐", "⭐⭐⭐⭐", "⭐⭐⭐⭐⭐"],
			progress: ["0%", "25%", "50%", "75%", "100%"],
			difficulty: ["Easy", "Medium", "Hard"],
			size: ["Small", "Medium", "Large"],
		};

		const normalizedFieldName = fieldName.toLowerCase();

		// Own keys only: a field name like `constructor` from an untrusted token
		// would otherwise resolve an inherited member and crash later.
		if (
			Object.prototype.hasOwnProperty.call(commonDefaults, normalizedFieldName)
		) {
			return commonDefaults[normalizedFieldName];
		}

		for (const [key, defaults] of Object.entries(commonDefaults)) {
			if (normalizedFieldName.includes(key) || key.includes(normalizedFieldName)) {
				return defaults;
			}
		}

		if (existingValues.length > 0) {
			const valueCounts = new Map<string, number>();
			
			for (const value of existingValues) {
				valueCounts.set(value, (valueCounts.get(value) || 0) + 1);
			}

			return Array.from(valueCounts.entries())
				.sort((a, b) => b[1] - a[1])
				.slice(0, 5)
				.map(([value]) => value);
		}

		return [];
	}
}
