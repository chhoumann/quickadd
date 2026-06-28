import { FIELD_VAR_REGEX_WITH_FILTERS } from "../constants";
import { FieldValueDeduplicator, type DeduplicationOptions } from "./FieldValueDeduplicator";
import type { FieldFilter } from "./FieldSuggestionParser";

export interface ProcessedValues {
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

	/**
	 * Process field values with deduplication, defaults, and sorting
	 */
	static processValues(
		rawValues: Set<string>,
		filters: FieldFilter
	): ProcessedValues {
		const totalProcessed = rawValues.size;
		let values = Array.from(rawValues).filter(
			(value) => !this.isUnresolvedFieldToken(value),
		);

		// Apply deduplication
		const deduplicationOptions: DeduplicationOptions = {
			strategy: filters.caseSensitive ? 'case-sensitive' : 'case-insensitive',
			preserveFirstOccurrence: true,
			sortResult: true
		};

		const deduplicationResult = FieldValueDeduplicator.deduplicate(values, deduplicationOptions);
		values = deduplicationResult.values;

		// Handle default values
		const { processedValues, hasDefault } = this.applyDefaultValues(values, filters);
		values = processedValues;

		return {
			values,
			hasDefaultValue: hasDefault,
			duplicatesRemoved: deduplicationResult.duplicatesRemoved,
			totalProcessed
		};
	}

	private static isUnresolvedFieldToken(value: string): boolean {
		return this.unresolvedFieldTokenRegex.test(value.trim());
	}

	/**
	 * Apply default value logic based on filters
	 */
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
	 * Promotes `value` to the front of an already-processed suggestion list,
	 * removing any existing entry that matches under the same case fold used for
	 * deduplication (issue #1429). Used for a context-derived default
	 * (`default-from:active`) so it appears first without duplicating an existing
	 * suggestion, mirroring the `default-always` branch of {@link applyDefaultValues}
	 * — but applied AFTER vault collection, so it never perturbs the collection
	 * cache key. The promoted entry keeps the supplied value's casing (the active
	 * note's current value), which is the value the user is inheriting.
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
	 * Returns the entry in `values` that matches `value` under the dedup case fold,
	 * or `value` itself when none does (issue #1429). Used to map an active-note
	 * preselection onto the existing (vault-cased) suggestion before handing it to
	 * the multi-select picker, so a case variant (active `Done` vs collected `done`)
	 * toggles the existing option instead of adding a duplicate custom row. With
	 * `caseSensitive` the value is returned unchanged.
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
	 * Normalize a value for case-insensitive comparison, mirroring
	 * FieldValueDeduplicator's fold (Unicode NFD + diacritic strip + lowercase)
	 * so default-value matching is consistent with case-insensitive dedup.
	 */
	private static normalizeForComparison(value: string): string {
		return value
			.normalize("NFD")
			.replace(/[\u0300-\u036f]/g, "")
			.toLowerCase();
	}

	/**
	 * Get suggestions with smart defaults based on existing patterns
	 */
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
		
		// Check for exact matches
		if (commonDefaults[normalizedFieldName]) {
			return commonDefaults[normalizedFieldName];
		}

		// Check for partial matches
		for (const [key, defaults] of Object.entries(commonDefaults)) {
			if (normalizedFieldName.includes(key) || key.includes(normalizedFieldName)) {
				return defaults;
			}
		}

		// If we have existing values, suggest the most common ones
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

	/**
	 * Validate default value against existing patterns
	 */
	static validateDefaultValue(
		defaultValue: string,
		existingValues: string[],
		fieldName: string
	): {
		isValid: boolean;
		suggestions: string[];
		warnings: string[];
	} {
		const warnings: string[] = [];
		const suggestions: string[] = [];
		const isValid = true;

		// Check if default value follows existing patterns
		if (existingValues.length > 0) {
			const caseAnalysis = FieldValueDeduplicator.analyzeVariations(existingValues);
			
			// Check case consistency
			const defaultNormalized = defaultValue.toLowerCase();
			for (const [normalized, variants] of caseAnalysis.caseVariations) {
				if (normalized === defaultNormalized) {
					if (!variants.includes(defaultValue)) {
						suggestions.push(...variants.slice(0, 3));
						warnings.push(`Consider using existing case: ${variants[0]}`);
					}
					break;
				}
			}

			// Check for similar values that might be typos
			const similarValues = FieldValueDeduplicator.getSuggestions(
				defaultValue,
				existingValues,
				0.8
			);

			if (similarValues.length > 0) {
				suggestions.push(...similarValues);
				warnings.push(`Similar existing values found: ${similarValues.slice(0, 3).join(", ")}`);
			}
		}

		// Get smart defaults for comparison
		const smartDefaults = this.getSmartDefaults(fieldName, existingValues);
		if (smartDefaults.length > 0 && !smartDefaults.includes(defaultValue)) {
			const normalizedDefaults = smartDefaults.map(d => d.toLowerCase());
			if (!normalizedDefaults.includes(defaultValue.toLowerCase())) {
				suggestions.push(...smartDefaults.slice(0, 3));
				warnings.push(`Consider common values for ${fieldName}: ${smartDefaults.slice(0, 3).join(", ")}`);
			}
		}

		return {
			isValid,
			suggestions: [...new Set(suggestions)], // Remove duplicates
			warnings
		};
	}
}
