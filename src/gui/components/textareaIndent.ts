/**
 * Tab-to-indent for multi-line text fields (issue #764).
 *
 * A plain textarea lets the browser move focus on Tab, so users can't indent to
 * build markdown sublists. {@link attachTextareaIndent} captures Tab and inserts
 * a tab character instead. The transform is split into a pure, unit-testable
 * {@link computeIndentEdit} (no DOM) and a thin DOM applier so the host textarea
 * keeps native undo and fires a real `input` event (so onChange/draft/validation
 * stay in sync).
 *
 * Scope is deliberately minimal: only Tab is captured. Shift+Tab is left alone so
 * it still moves focus — that keeps both surfaces free of any keyboard trap.
 */

const DEFAULT_TAB = "\t";

export interface IndentEdit {
	/** Region of the current value to replace (applied via one undoable edit). */
	regionStart: number;
	regionEnd: number;
	/** Text the region is replaced with. */
	replacement: string;
	/** Where the selection should land afterward. */
	selectionStart: number;
	selectionEnd: number;
}

/**
 * Compute the edit for pressing Tab with the given selection.
 *
 * - Collapsed caret: insert a single tab at the caret.
 * - Any selection: block-indent every line the selection touches. We never
 *   replace the selected text with a single tab — that would lose data (the wide
 *   prompt opens with its whole value selected, so the first Tab would wipe it).
 */
export function computeIndentEdit(
	value: string,
	selStart: number,
	selEnd: number,
	opts: { tab?: string } = {},
): IndentEdit {
	const tab = opts.tab ?? DEFAULT_TAB;

	if (selStart === selEnd) {
		const caret = selStart + tab.length;
		return {
			regionStart: selStart,
			regionEnd: selStart,
			replacement: tab,
			selectionStart: caret,
			selectionEnd: caret,
		};
	}

	// Block-indent: grow the region back to the start of the first touched line so
	// we prefix whole lines. The selStart === 0 guard is load-bearing: JS clamps a
	// negative fromIndex to 0, so lastIndexOf("\n", -1) would match a leading "\n"
	// at index 0 and push firstLineStart to 1, dropping the first line.
	const firstLineStart =
		selStart === 0 ? 0 : value.lastIndexOf("\n", selStart - 1) + 1;
	const region = value.slice(firstLineStart, selEnd);
	const segments = region.split("\n");
	const lastIndex = segments.length - 1;

	let added = 0;
	const indented = segments.map((segment, i) => {
		// A trailing empty segment is the start of the line AFTER the selection
		// (the selection ended on a newline) — the user didn't select it, so leave
		// it alone instead of indenting the next line.
		if (i === lastIndex && segment === "") return segment;
		added += tab.length;
		return tab + segment;
	});

	return {
		regionStart: firstLineStart,
		regionEnd: selEnd,
		replacement: indented.join("\n"),
		// Keep the user's selection over the same text, shifted by the inserted
		// tabs. The first touched line always gets a tab at/<= selStart.
		selectionStart: selStart + tab.length,
		selectionEnd: selEnd + added,
	};
}

/** Apply an {@link IndentEdit} to a textarea, preserving native undo when possible. */
export function applyIndentEdit(
	inputEl: HTMLTextAreaElement,
	edit: IndentEdit,
): void {
	inputEl.setSelectionRange(edit.regionStart, edit.regionEnd);

	const doc = inputEl.ownerDocument;
	let inserted = false;
	try {
		// execCommand is the only way to mutate a textarea while keeping the native
		// undo stack (one step) and firing a trusted input event. It is deprecated
		// but fully supported in Obsidian's Electron/Chromium runtime.
		inserted =
			typeof doc.execCommand === "function" &&
			doc.execCommand("insertText", false, edit.replacement);
	} catch {
		inserted = false;
	}

	if (!inserted) {
		// Fallback for runtimes without execCommand (e.g. jsdom in tests). Native
		// undo is lost, but onChange/draft stay in sync via the dispatched event.
		// Restore the final selection BEFORE dispatching so any listener that reads
		// the selection during `input` sees the settled state, not an interim one.
		const value = inputEl.value;
		inputEl.value =
			value.slice(0, edit.regionStart) +
			edit.replacement +
			value.slice(edit.regionEnd);
		inputEl.setSelectionRange(edit.selectionStart, edit.selectionEnd);
		inputEl.dispatchEvent(new Event("input", { bubbles: true }));
		return;
	}

	inputEl.setSelectionRange(edit.selectionStart, edit.selectionEnd);
}

/**
 * Capture Tab on a textarea so it inserts/indents instead of moving focus.
 * Returns a disposer that removes the listener (idempotent).
 */
export function attachTextareaIndent(
	inputEl: HTMLTextAreaElement,
	opts: { tab?: string } = {},
): () => void {
	const onKeyDown = (evt: KeyboardEvent) => {
		// Only plain Tab. Shift+Tab keeps native focus traversal (no trap), and
		// modifier combos stay reserved for OS/Obsidian shortcuts. Skip IME
		// composition, and yield if an earlier listener already handled the event.
		if (
			evt.key !== "Tab" ||
			evt.shiftKey ||
			evt.ctrlKey ||
			evt.metaKey ||
			evt.altKey ||
			evt.isComposing ||
			evt.defaultPrevented
		) {
			return;
		}

		evt.preventDefault();

		const start = inputEl.selectionStart ?? inputEl.value.length;
		const end = inputEl.selectionEnd ?? start;
		applyIndentEdit(inputEl, computeIndentEdit(inputEl.value, start, end, opts));
	};

	inputEl.addEventListener("keydown", onKeyDown);

	let disposed = false;
	return () => {
		if (disposed) return;
		disposed = true;
		inputEl.removeEventListener("keydown", onKeyDown);
	};
}
