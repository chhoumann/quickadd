import {
	FieldValueDeduplicator,
	type DeduplicationOptions,
} from "./FieldValueDeduplicator";
import type { FieldFilter } from "./FieldSuggestionParser";

export interface ProcessedValues {
	values: string[];
	hasDefaultValue: boolean;
	duplicatesRemoved: number;
	totalProcessed: number;
}

/**
 * Process field values with deduplication, defaults, and sorting
 */
function processValues(
	rawValues: Set<string>,
	filters: FieldFilter
): ProcessedValues {
	let values = Array.from(rawValues);
	const totalProcessed = values.length;

	// Apply deduplication
	const deduplicationOptions: DeduplicationOptions = {
		strategy: filters.caseSensitive ? "case-sensitive" : "case-insensitive",
		preserveFirstOccurrence: true,
		sortResult: true,
	};

	const deduplicationResult = FieldValueDeduplicator.deduplicate(
		values,
		deduplicationOptions
	);
	values = deduplicationResult.values;

	// Handle default values
	const { processedValues, hasDefault } = applyDefaultValues(values, filters);
	values = processedValues;

	return {
		values,
		hasDefaultValue: hasDefault,
		duplicatesRemoved: deduplicationResult.duplicatesRemoved,
		totalProcessed,
	};
}

/**
 * Apply default value logic based on filters
 */
function applyDefaultValues(
	values: string[],
	filters: FieldFilter
): { processedValues: string[]; hasDefault: boolean } {
	if (!filters.defaultValue) {
		return { processedValues: values, hasDefault: false };
	}

	const defaultValue = filters.defaultValue;
	let processedValues = [...values];
	let hasDefault = false;

	if (filters.defaultAlways) {
		// Always include default at the beginning, remove if already present
		processedValues = processedValues.filter((v) => v !== defaultValue);
		processedValues.unshift(defaultValue);
		hasDefault = true;
	} else if (filters.defaultEmpty && values.length === 0) {
		// Only include default if no values found
		processedValues = [defaultValue];
		hasDefault = true;
	} else if (!filters.defaultEmpty && !filters.defaultAlways) {
		// Default behavior: include if not already present and prepend
		if (!processedValues.includes(defaultValue)) {
			processedValues.unshift(defaultValue);
			hasDefault = true;
		}
	}

	return { processedValues, hasDefault };
}

/**
 * Get suggestions with smart defaults based on existing patterns
 */
function getSmartDefaults(
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
		if (
			normalizedFieldName.includes(key) ||
			key.includes(normalizedFieldName)
		) {
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
function validateDefaultValue(
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
		const caseAnalysis =
			FieldValueDeduplicator.analyzeVariations(existingValues);

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
			warnings.push(
				`Similar existing values found: ${similarValues.slice(0, 3).join(", ")}`
			);
		}
	}

	// Get smart defaults for comparison
	const smartDefaults = getSmartDefaults(fieldName, existingValues);
	if (smartDefaults.length > 0 && !smartDefaults.includes(defaultValue)) {
		const normalizedDefaults = smartDefaults.map((d) => d.toLowerCase());
		if (!normalizedDefaults.includes(defaultValue.toLowerCase())) {
			suggestions.push(...smartDefaults.slice(0, 3));
			warnings.push(
				`Consider common values for ${fieldName}: ${smartDefaults.slice(0, 3).join(", ")}`
			);
		}
	}

	return {
		isValid,
		suggestions: [...new Set(suggestions)], // Remove duplicates
		warnings,
	};
}

export const FieldValueProcessor = {
	processValues,
	getSmartDefaults,
	validateDefaultValue,
};
