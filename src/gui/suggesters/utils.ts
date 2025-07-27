/**
 * Utility functions for text manipulation in suggesters
 */

/**
 * Insert text at cursor position
 */
export function insertAtCursor(
	input: HTMLInputElement | HTMLTextAreaElement,
	text: string
): void {
	const start = input.selectionStart ?? 0;
	const end = input.selectionEnd ?? 0;
	const value = input.value;
	
	input.value = value.slice(0, start) + text + value.slice(end);
	input.setSelectionRange(start + text.length, start + text.length);
	input.trigger("input");
}

/**
 * Replace text in a range
 */
export function replaceRange(
	input: HTMLInputElement | HTMLTextAreaElement,
	start: number,
	end: number,
	replacement: string
): void {
	const value = input.value;
	input.value = value.slice(0, start) + replacement + value.slice(end);
	input.setSelectionRange(start + replacement.length, start + replacement.length);
	input.trigger("input");
}

/**
 * Get text before cursor up to a certain length
 */
export function getTextBeforeCursor(
	input: HTMLInputElement | HTMLTextAreaElement,
	lookbehind = 15
): string {
	const cursorPosition = input.selectionStart ?? 0;
	return input.value.slice(Math.max(0, cursorPosition - lookbehind), cursorPosition);
}

/**
 * Default highlighting function that wraps matching text in <mark> tags
 */
export function highlightMatches(text: string, query: string): string {
	if (!query) return text;
	
	const escapedQuery = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
	const regex = new RegExp(`(${escapedQuery})`, 'gi');
	return text.replace(regex, '<mark>$1</mark>');
}

/**
 * Fuzzy match highlighting - highlights individual matching characters
 */
export function highlightFuzzyMatches(text: string, query: string): string {
	if (!query) return text;
	
	const queryChars = query.toLowerCase().split('');
	const textChars = text.split('');
	let queryIndex = 0;
	
	for (let i = 0; i < textChars.length && queryIndex < queryChars.length; i++) {
		if (textChars[i].toLowerCase() === queryChars[queryIndex]) {
			textChars[i] = `<mark>${textChars[i]}</mark>`;
			queryIndex++;
		}
	}
	
	return textChars.join('');
}

/**
 * Single-source heading sanitizer with cached regex patterns.
 * Removes wikilinks, images, and markdown formatting from heading text.
 */
export const sanitizeHeading = (() => {
	const imgRE     = /!\[\[[^\]]*\]\]/g;                   // ![[img.png]] - process first
	const wikiRE    = /\[\[([^\]|]*?)(\|([^\]]*?))?\]\]/g;  // [[page]] or [[page|alias]]
	const mdRE      = /[*_`~]/g;                            // *, _, `, ~ (global flag for all occurrences)
	const trimHashRE = /^#+\s*|\s*#+$/g;                    // leading/trailing # from ATX headings
	const strayRE   = /\[\[|\]\]/g;                         // any leftover [[ ]]

	return (heading: string): string =>
		heading
			.replace(imgRE,     '')                         // Remove images first
			.replace(wikiRE,    (_, p1, _p2, alias) => alias ?? p1) // Then handle wikilinks
			.replace(mdRE,      '')                         // Remove markdown formatting
			.replace(trimHashRE, '')                        // Remove ATX heading markers
			.replace(strayRE,   '')                         // Clean up stray brackets
			.trim();
})();
