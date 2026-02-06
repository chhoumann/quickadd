/**
 * Utility functions for text manipulation in suggesters
 */

export function normalizeDisplayItem(value: unknown): string {
	if (typeof value === "string") return value;
	if (value == null) return "";
	return String(value);
}

export function normalizeQuery(value: unknown): string {
	return normalizeDisplayItem(value);
}

export function normalizeForSearch(value: string): string {
	return value.normalize("NFC").toLowerCase();
}

// Display-only helper: keep stored path intact, but hide trailing ".md" in UI labels.
export function stripMdExtensionForDisplay(value: string): string {
	return value.toLowerCase().endsWith(".md") ? value.slice(0, -3) : value;
}

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
 * Render exact match highlighting with DOM nodes (XSS-safe, handles HTML entities correctly)
 */
export function renderExactHighlight(el: HTMLElement, text: string, query: string): void {
	el.replaceChildren();
	if (!query) {
		el.textContent = text;
		return;
	}

	const lower = text.toLowerCase();
	const q = query.toLowerCase();
	let from = 0;
	let idx = lower.indexOf(q, from);

	while (idx !== -1) {
		if (idx > from) el.append(document.createTextNode(text.slice(from, idx)));

		const mark = document.createElement('mark');
		mark.className = 'qa-highlight';
		mark.textContent = text.slice(idx, idx + query.length);
		el.append(mark);

		from = idx + query.length;
		idx = lower.indexOf(q, from);
	}

	if (from < text.length) el.append(document.createTextNode(text.slice(from)));
}

/**
 * Render fuzzy match highlighting with DOM nodes (XSS-safe, handles HTML entities correctly)
 */
export function renderFuzzyHighlight(el: HTMLElement, text: string, query: string): void {
	el.replaceChildren();
	if (!query) {
		el.textContent = text;
		return;
	}

	const q = query.toLowerCase();
	let qi = 0;

	for (const ch of text) {
		if (qi < q.length && ch.toLowerCase() === q[qi]) {
			const mark = document.createElement('mark');
			mark.className = 'qa-highlight';
			mark.textContent = ch;
			el.append(mark);
			qi++;
		} else {
			el.append(document.createTextNode(ch));
		}
	}
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
