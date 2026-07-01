import type { Instruction, Scope } from "obsidian";
import { createOwnedElement, createOwnedTextNode } from "src/utils/activeWindow";

type CompletionInputEvent = Event & {
	fromCompletion?: boolean;
};

/**
 * Utility functions for text manipulation in suggesters
 */

export function normalizeDisplayItem(value: unknown): string {
	if (typeof value === "string") return value;
	if (value == null) return "";
	return String(value);
}

type SkipCapableModal = {
	scope?: Scope;
	setInstructions?: (instructions: Instruction[]) => void;
	// SuggestModal exposes modalEl; used to mount a touch/mouse-friendly Skip
	// button. Optional because the test stub's FuzzySuggestModal lacks it.
	modalEl?: HTMLElement;
};

/**
 * Wires the skip affordance for optional tokens onto a suggester modal: an
 * instructions footer, a Mod+Shift+Enter scope binding, and a touch/mouse Skip
 * button — all invoking the modal's skip resolution. Every hook is
 * runtime-guarded because the test stub's FuzzySuggestModal provides none of
 * scope, setInstructions, or modalEl.
 */
export function installSkipAffordance(
	modal: SkipCapableModal,
	onSkip: () => void,
): void {
	modal.scope?.register(["Mod", "Shift"], "Enter", () => {
		onSkip();
		return false;
	});

	if (typeof modal.setInstructions === "function") {
		modal.setInstructions([
			{ command: "↑↓", purpose: "to navigate" },
			{ command: "↵", purpose: "to choose" },
			{ command: "ctrl/cmd+shift+↵", purpose: "to skip (leave empty)" },
			{ command: "esc", purpose: "to cancel" },
		]);
	}

	// Mod+Shift+Enter is keyboard-only; mobile/pointer users get no modifier
	// keys, so add a visible Skip button (matching the text prompt and
	// MultiSuggester) that resolves the same "leave empty" answer.
	const modalEl = modal.modalEl;
	if (modalEl && typeof modalEl.createDiv === "function") {
		const skipBar = modalEl.createDiv({
			cls: "qa-suggester-skip-bar",
		});
		const skipButton = skipBar.createEl("button", {
			text: "Skip (leave empty)",
			cls: "qa-suggester-skip-button",
		});
		skipButton.type = "button";
		skipButton.setAttribute("aria-label", "Skip and leave empty");
		skipButton.addEventListener("click", (evt) => {
			evt.preventDefault();
			onSkip();
		});
	}
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
		(event as CompletionInputEvent).fromCompletion = true;
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

	// Lowercase `text` by code point, recording for every lowercased code unit
	// the [start, end) span of the ORIGINAL character it came from. toLowerCase()
	// can change UTF-16 length (e.g. U+0130 'İ' -> 'i' + combining dot), so an
	// index found in the lowercased domain does not line up with `text`; mapping
	// it back through these spans keeps the <mark> on the right characters.
	// Iterating by code point (for..of) also lowercases astral cased characters
	// correctly. A match can begin or end partway through one character's
	// expansion (typing 'i' matches the 'i' inside 'İ'); using the start of the
	// character that holds the FIRST matched unit and the end of the character
	// that holds the LAST one makes the mark wrap those whole characters instead
	// of collapsing to an empty span.
	let lower = "";
	const startInText: number[] = [];
	const endInText: number[] = [];
	let cursor = 0;
	for (const ch of text) {
		const lc = ch.toLowerCase();
		const start = cursor;
		const end = cursor + ch.length;
		for (let i = 0; i < lc.length; i++) {
			startInText.push(start);
			endInText.push(end);
		}
		lower += lc;
		cursor = end;
	}

	// Lowercase the query by code point too, so the search domain is symmetric
	// with `lower`. Whole-string toLowerCase() applies context-sensitive folding
	// (Greek final sigma: "ΣΣ".toLowerCase() === "σς") that the per-character
	// `lower` does not, which would otherwise drop the highlight even when the
	// query equals the text exactly.
	let q = "";
	for (const ch of query) q += ch.toLowerCase();

	let from = 0; // cursor in the original `text`
	let lowerFrom = 0; // cursor in the lowercased domain
	let idx = lower.indexOf(q, lowerFrom);

	while (idx !== -1) {
		// Clamp the start to `from` so two matches landing inside one character's
		// expansion can never emit a backward or duplicated slice; this keeps the
		// concatenated output byte-identical to the original `text`.
		const matchStart = Math.max(from, startInText[idx]);
		const matchEnd = endInText[idx + q.length - 1];

		if (matchEnd > matchStart) {
			if (matchStart > from) el.append(createOwnedTextNode(el, text.slice(from, matchStart)));

			const mark = createOwnedElement(el, 'mark');
			mark.className = 'qa-highlight';
			mark.textContent = text.slice(matchStart, matchEnd);
			el.append(mark);

			from = matchEnd;
		}

		lowerFrom = idx + q.length;
		idx = lower.indexOf(q, lowerFrom);
	}

	if (from < text.length) el.append(createOwnedTextNode(el, text.slice(from)));
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
			const mark = createOwnedElement(el, 'mark');
			mark.className = 'qa-highlight';
			mark.textContent = ch;
			el.append(mark);
			qi++;
		} else {
			el.append(createOwnedTextNode(el, ch));
		}
	}
}

// Single-source heading sanitizer; lives in its own dependency-free module
// (linear scanners - the old chained regexes were quadratic on adversarial
// headings). Re-exported here so existing imports keep working.
export { sanitizeHeading } from "./headingSanitizer";
