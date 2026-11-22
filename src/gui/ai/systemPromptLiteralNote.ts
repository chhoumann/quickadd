/**
 * The AI system prompt is sent to the model verbatim; only the prompt itself is
 * formatted, so `{{DATE}}` in a system prompt reaches the model as typed. The
 * note shows only when the value contains `{{`, since most system prompts have
 * no tokens. Over-firing on LaTeX braces is accepted: a false positive costs one
 * muted line, a false negative a silently broken prompt.
 */

const LITERAL_NOTE_TEXT =
	"QuickAdd sends the system prompt to the model as written - format syntax like {{DATE}} is not resolved here. Only the prompt template is formatted.";

/** Distinguishes the notes of two modals open at once, and across `reload()`. */
let noteSequence = 0;

/**
 * Renders a muted note under a system-prompt field, and returns the updater to
 * call from the field's `onChange`.
 *
 * The element is created up front and hidden rather than created on demand: the
 * modals build their DOM imperatively and append as they go, so a lazily created
 * note would land at the bottom of the modal instead of under its field.
 */
export function mountSystemPromptLiteralNote(
	container: HTMLElement,
	field: HTMLTextAreaElement,
	initialValue: string,
): (value: string) => void {
	const note = container.createDiv({
		text: LITERAL_NOTE_TEXT,
		cls: "qa-literal-format-note",
	});
	const noteId = `qa-literal-format-note-${++noteSequence}`;
	note.id = noteId;

	// classList/setAttribute, not Obsidian's toggleClass: this runs under the
	// vitest DOM stub too, which patches createEl/addClass but not toggleClass.
	const update = (value: string): void => {
		const shown = value.includes("{{");
		note.classList.toggle("qa-literal-format-note--shown", shown);
		// Referenced only while shown. An accessible description may include a
		// directly-referenced hidden node, so leaving the reference in place would
		// describe the field with a note the sighted user cannot see.
		if (shown) field.setAttribute("aria-describedby", noteId);
		else field.removeAttribute("aria-describedby");
	};

	update(initialValue);
	return update;
}
