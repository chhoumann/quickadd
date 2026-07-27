/**
 * The AI system prompt is sent to the model VERBATIM. QuickAdd's format syntax
 * is applied to the prompt (or prompt template) only:
 *
 *   - `runAIAssistant` formats `targetPrompt`, passes `systemPrompt` raw
 *     (src/ai/AIAssistant.ts).
 *   - `Prompt` / `ChunkedPrompt` do the same, and the chunked path even sizes
 *     its budget with `estimateTokenCount(systemPrompt)` on the raw string.
 *   - `MacroChoiceEngine.executeAIAssistant` hands `command.systemPrompt`
 *     straight through while its formatter callback wraps only the prompt.
 *   - `Agent.buildSeedMessages` pushes `system` raw and formats `prompt`.
 *
 * All four are pinned by AIAssistant.systemPromptLiteral.test.ts.
 *
 * Until #1572 decides otherwise, `{{DATE}}` in a system prompt reaches the model
 * as the eight characters `{{DATE}}`. The system-prompt modals used to
 * claim the opposite - a live "preview" resolving the tokens, plus a `{{`
 * autocomplete offering them (issues #1565, #1568). Both are gone; this note is
 * what replaces them.
 *
 * Deliberately conditional on the value containing `{{`, rather than a sentence
 * in `setDesc()` that is always visible. The token-free prose prompt is the
 * overwhelming majority - it is the shipped default and the seed for every new
 * AI command - and a permanent line about a syntax that does not apply is the
 * kind of standing chrome the builders' own hints were designed to avoid
 * (#1570). The audience here is narrow and specific: an author who already
 * typed a token, most likely on the deleted autocomplete's advice, and who would
 * otherwise get no signal at all.
 *
 * The `{{` trigger over-fires on prose or LaTeX that happens to contain two
 * braces (`\frac{{a}}{b}`). That is deliberate: the note is muted and states a
 * fact about the field, so a false positive costs one quiet line, while a false
 * negative costs a silently broken prompt.
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
	const note = container.createEl("div", {
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
