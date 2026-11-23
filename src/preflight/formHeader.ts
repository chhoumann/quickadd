export const DEFAULT_ONE_PAGE_FORM_TITLE = "Provide inputs";

export interface OnePageFormHeader {
	title?: string;
	description?: string;
}

function nonBlank(value: unknown): string | undefined {
	if (typeof value !== "string") return undefined;
	return value.trim() || undefined;
}

export function sanitizeOnePageFormHeader(
	input: unknown,
): OnePageFormHeader | undefined {
	if (!input || typeof input !== "object") return undefined;
	const record = input as Record<string, unknown>;
	const title = nonBlank(record.title);
	const description = nonBlank(record.description);
	if (!title && !description) return undefined;
	const header: OnePageFormHeader = {};
	if (title) header.title = title;
	if (description) header.description = description;
	return header;
}
