export interface DeduplicationResult {
	values: string[];
	duplicatesRemoved: number;
	strategy: 'case-sensitive' | 'case-insensitive' | 'exact';
}

export interface DeduplicationOptions {
	strategy?: 'case-sensitive' | 'case-insensitive' | 'exact';
	preserveFirstOccurrence?: boolean;
	sortResult?: boolean;
}

export class FieldValueDeduplicator {
	/**
	 * Deduplicate field values with case-insensitive support
	 * @param values Array of values to deduplicate
	 * @param options Deduplication options
	 */
	static deduplicate(
		values: string[], 
		options: DeduplicationOptions = {}
	): DeduplicationResult {
		const {
			strategy = 'case-insensitive',
			preserveFirstOccurrence = true,
			sortResult = true
		} = options;

		const originalCount = values.length;
		let deduplicatedValues: string[];

		switch (strategy) {
			case 'exact':
				deduplicatedValues = this.deduplicateExact(values);
				break;
			case 'case-sensitive':
				deduplicatedValues = this.deduplicateCaseSensitive(values, preserveFirstOccurrence);
				break;
			case 'case-insensitive':
			default:
				deduplicatedValues = this.deduplicateCaseInsensitive(values, preserveFirstOccurrence);
				break;
		}

		if (sortResult) {
			deduplicatedValues = this.sortValues(deduplicatedValues, strategy);
		}

		return {
			values: deduplicatedValues,
			duplicatesRemoved: originalCount - deduplicatedValues.length,
			strategy
		};
	}

	/**
	 * Simple Set-based deduplication
	 */
	private static deduplicateExact(values: string[]): string[] {
		return Array.from(new Set(values));
	}

	/**
	 * Case-sensitive deduplication preserving first occurrence
	 */
	private static deduplicateCaseSensitive(values: string[], preserveFirst: boolean): string[] {
		if (preserveFirst) {
			const seen = new Set<string>();
			return values.filter(value => {
				if (seen.has(value)) return false;
				seen.add(value);
				return true;
			});
		}
		return Array.from(new Set(values));
	}

	/**
	 * Case-insensitive deduplication with original case preservation
	 */
	private static deduplicateCaseInsensitive(values: string[], preserveFirst: boolean): string[] {
		const seen = new Map<string, string>(); // lowercase -> original case
		
		for (const value of values) {
			const normalized = this.normalizeForComparison(value);
			
			if (!seen.has(normalized)) {
				seen.set(normalized, value);
			} else if (!preserveFirst) {
				// If not preserving first, update with latest occurrence
				seen.set(normalized, value);
			}
		}

		return Array.from(seen.values());
	}

	/**
	 * Normalize string for case-insensitive comparison
	 * Handles Unicode normalization and case folding
	 */
	private static normalizeForComparison(value: string): string {
		// Unicode normalization (NFD to decompose accents) + case folding + remove diacritics
		return value
			.normalize('NFD')
			.replace(/[\u0300-\u036f]/g, '') // Remove diacritics/accents
			.toLowerCase();
	}

	/**
	 * Sort values while preserving case preference
	 */
	private static sortValues(values: string[], strategy: string): string[] {
		return values.sort((a, b) => {
			if (strategy === 'case-insensitive') {
				// Case-insensitive sort but preserve original casing
				const aLower = a.toLowerCase();
				const bLower = b.toLowerCase();
				
				if (aLower === bLower) {
					// If case-insensitive equal, prefer title case or original case
					return this.getCasePriority(a) - this.getCasePriority(b);
				}
				
				return aLower.localeCompare(bLower);
			}
			
			return a.localeCompare(b);
		});
	}

	/**
	 * Get priority for case preference (lower number = higher priority)
	 */
	private static getCasePriority(value: string): number {
		if (value === value.toUpperCase()) return 3; // ALL CAPS (lowest priority)
		if (value === value.toLowerCase()) return 2; // all lowercase
		if (value[0] === value[0].toUpperCase()) return 1; // Title Case
		return 0; // Mixed case (highest priority)
	}

	/**
	 * Get statistics about case variations in the dataset
	 */
	static analyzeVariations(values: string[]): {
		totalValues: number;
		uniqueValues: number;
		caseVariations: Map<string, string[]>;
		mostCommonCase: string;
	} {
		const variations = new Map<string, string[]>();
		
		for (const value of values) {
			const normalized = this.normalizeForComparison(value);
			
			if (!variations.has(normalized)) {
				variations.set(normalized, []);
			}
			
			const variationsList = variations.get(normalized);
			if (variationsList) {
				variationsList.push(value);
			}
		}

		// Find most common case pattern
		let maxVariations = 0;
		let mostCommonCase = '';
		
		for (const [normalized, variants] of variations) {
			if (variants.length > maxVariations) {
				maxVariations = variants.length;
				mostCommonCase = normalized;
			}
		}

		return {
			totalValues: values.length,
			uniqueValues: variations.size,
			caseVariations: variations,
			mostCommonCase
		};
	}

	/**
	 * Get suggested corrections for potential typos based on case variations
	 */
	static getSuggestions(
		target: string, 
		existingValues: string[], 
		threshold = 0.8
	): string[] {
		const targetNormalized = this.normalizeForComparison(target);
		const suggestions: string[] = [];

		for (const value of existingValues) {
			const valueNormalized = this.normalizeForComparison(value);
			const similarity = this.calculateSimilarity(targetNormalized, valueNormalized);
			
			if (similarity >= threshold && targetNormalized !== valueNormalized) {
				suggestions.push(value);
			}
		}

		return suggestions.slice(0, 5); // Limit to 5 suggestions
	}

	/**
	 * Calculate string similarity using Levenshtein distance
	 */
	private static calculateSimilarity(a: string, b: string): number {
		if (a.length === 0) return b.length === 0 ? 1 : 0;
		if (b.length === 0) return 0;

		const matrix: number[][] = [];

		// Initialize first row and column
		for (let i = 0; i <= b.length; i++) {
			matrix[i] = [i];
		}
		for (let j = 0; j <= a.length; j++) {
			matrix[0][j] = j;
		}

		// Fill matrix
		for (let i = 1; i <= b.length; i++) {
			for (let j = 1; j <= a.length; j++) {
				if (b.charAt(i - 1) === a.charAt(j - 1)) {
					matrix[i][j] = matrix[i - 1][j - 1];
				} else {
					matrix[i][j] = Math.min(
						matrix[i - 1][j - 1] + 1, // substitution
						matrix[i][j - 1] + 1,     // insertion
						matrix[i - 1][j] + 1      // deletion
					);
				}
			}
		}

		const maxLength = Math.max(a.length, b.length);
		return 1 - (matrix[b.length][a.length] / maxLength);
	}
}
