import type { Instruction, Scope } from "obsidian";
import { log } from "src/logger/logManager";
import { createOwnedElement, createOwnedTextNode } from "src/utils/activeWindow";
import { toError } from "src/utils/errorUtils";

type CompletionInputEvent = Event & {
	fromCompletion?: boolean;
};

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

/**
 * A one-shot warner for a render fallback, scoped to one modal. renderSuggestion
 * re-runs per row per keystroke, so a throwing `renderItem` would raise a Notice
 * per row per render; the first failure is the whole message. The context goes
 * through {@link toError}, which never mutates the caller's Error.
 */
export function createRenderFallbackWarner(
	context: string,
): (error: unknown) => void {
	let warned = false;
	return (error: unknown): void => {
		if (warned) return;
		warned = true;
		log.logWarning(toError(error, context));
	};
}

// Display-only helper: keep stored path intact, but hide trailing ".md" in UI labels.
export function stripMdExtensionForDisplay(value: string): string {
	return value.toLowerCase().endsWith(".md") ? value.slice(0, -3) : value;
}

/**
 * Replace `[start, end)` of the field's text, put the caret after the
 * replacement, and dispatch `input` so listeners see the change.
 */
export function replaceInputRange(
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
		(event as CompletionInputEvent).fromCompletion = true;
	}
	input.dispatchEvent(event);
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

	// Lowercase by code point, recording each lowered unit's span in the original:
	// toLowerCase can change UTF-16 length ('İ' -> 'i' + combining dot), so lowered
	// indices are mapped back through these spans. A match inside one character's
	// expansion marks the whole character.
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
 * Render `text` with the given [start, end) ranges wrapped in highlight marks
 * (DOM nodes, so HTML in `text` stays literal). `offset` shifts ranges that were
 * computed on a longer string this text is a slice of, e.g. a label searched as
 * "label path"; ranges outside the text are clipped away.
 */
export function renderHighlightRanges(
	el: HTMLElement,
	text: string,
	ranges: ReadonlyArray<readonly [number, number]>,
	offset = 0,
): void {
	el.replaceChildren();
	let from = 0;
	for (const [rangeStart, rangeEnd] of ranges) {
		const start = Math.max(from, rangeStart - offset);
		const end = Math.min(text.length, rangeEnd - offset);
		if (end <= start) continue;
		if (start > from) el.append(createOwnedTextNode(el, text.slice(from, start)));
		const mark = createOwnedElement(el, "mark");
		mark.className = "qa-highlight";
		mark.textContent = text.slice(start, end);
		el.append(mark);
		from = end;
	}
	if (from < text.length) el.append(createOwnedTextNode(el, text.slice(from)));
}

/** Mark input changes made by a picker so its refresh does not reopen a completed selection. */
export function dispatchCompletion(input: HTMLInputElement | HTMLTextAreaElement, keepOpen = false): void {
	const event = Object.assign(new Event("input", { bubbles: true }), {
		fromCompletion: true,
		...(keepOpen ? { keepOpen: true } : {}),
	});
	input.dispatchEvent(event);
}
