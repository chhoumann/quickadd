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
	replacement: string,
	options: { fromCompletion?: boolean } = {}
): void {
	const value = input.value;
	input.value = value.slice(0, start) + replacement + value.slice(end);
	input.setSelectionRange(start + replacement.length, start + replacement.length);
	
	const event = new Event("input", { bubbles: true });
	if (options.fromCompletion) {
		// Mark this as a programmatic completion change
		(event as any).fromCompletion = true;
	}
	input.dispatchEvent(event);
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
 * Escape HTML entities to prevent XSS
 */
function escapeHtml(text: string): string {
	const div = document.createElement('div');
	div.textContent = text;
	return div.innerHTML;
}

/**
 * Default highlighting function that wraps matching text in <mark> tags
 */
export function highlightMatches(text: string, query: string): string {
	if (!query) return escapeHtml(text);
	
	const escapedText = escapeHtml(text);
	const escapedQuery = escapeHtml(query).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
	const regex = new RegExp(`(${escapedQuery})`, 'gi');
	return escapedText.replace(regex, '<mark class="qa-highlight">$1</mark>');
}

/**
 * Fuzzy match highlighting - highlights individual matching characters
 */
export function highlightFuzzyMatches(text: string, query: string): string {
	if (!query) return escapeHtml(text);
	
	const queryChars = query.toLowerCase().split('');
	const textChars = text.split('');
	let queryIndex = 0;
	
	const result: string[] = [];
	for (let i = 0; i < textChars.length && queryIndex < queryChars.length; i++) {
		const char = textChars[i];
		if (char.toLowerCase() === queryChars[queryIndex]) {
			result.push(`<mark class="qa-highlight">${escapeHtml(char)}</mark>`);
			queryIndex++;
		} else {
			result.push(escapeHtml(char));
		}
	}
	
	// Add remaining characters if query finished early
	for (let i = result.length; i < textChars.length; i++) {
		result.push(escapeHtml(textChars[i]));
	}
	
	return result.join('');
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
