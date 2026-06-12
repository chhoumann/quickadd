const ASCII_BYTES_PER_TOKEN_ESTIMATE = 4;
const MIXED_BYTES_PER_TOKEN_ESTIMATE = 3;
const DEFAULT_INPUT_BUDGET_RATIO = 0.45;

export function estimateTokenCount(text: string): number {
	if (text.length === 0) return 0;

	const bytes = new TextEncoder().encode(text).length;
	const hasNonAscii = /[^\x00-\x7F]/.test(text);
	const bytesPerToken = hasNonAscii
		? MIXED_BYTES_PER_TOKEN_ESTIMATE
		: ASCII_BYTES_PER_TOKEN_ESTIMATE;

	return Math.max(1, Math.ceil(bytes / bytesPerToken));
}

export function estimateModelInputBudget(maxTokens: number): number {
	if (!Number.isFinite(maxTokens) || maxTokens <= 0) return 1;

	return Math.max(1, Math.floor(maxTokens * DEFAULT_INPUT_BUDGET_RATIO));
}
