/**
 * The AI system prompt is sent to the model VERBATIM. QuickAdd's format syntax
 * is applied to the prompt (or prompt template) only:
 *
 *   - `runAIAssistant`  formats `targetPrompt`, passes `systemPrompt` raw
 *     (src/ai/AIAssistant.ts).
 *   - `Prompt` / `ChunkedPrompt` do the same, and the chunked path even sizes
 *     its budget with `estimateTokenCount(systemPrompt)` on the raw string.
 *   - `MacroChoiceEngine.executeAIAssistant` hands `command.systemPrompt`
 *     straight through while its formatter callback wraps only the prompt.
 *   - `Agent.buildSeedMessages` pushes `system` raw and formats `prompt`.
 *
 * Until #1572 decides otherwise, `{{DATE}}` in a system prompt reaches the model
 * as the eight characters `{{DATE}}`. The three system-prompt modals used to
 * claim the opposite - a live "preview" resolving the tokens, plus a `{{`
 * autocomplete offering them (issues #1565, #1568). Both are gone; this note is
 * what replaces them, and only for the authors who already have a token in
 * there and would otherwise get no signal at all.
 *
 * Shown only when the value contains `{{`, so the shipped default prompt (and
 * every prose prompt) never sees it.
 */

const LITERAL_NOTE_TEXT =
	"QuickAdd sends this prompt to the model as written - format syntax like {{DATE}} is not resolved here. Use the prompt template for text that needs tokens.";

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
	initialValue: string,
): (value: string) => void {
	const note = container.createEl("div", {
		text: LITERAL_NOTE_TEXT,
		cls: "qa-literal-format-note",
	});

	// classList, not Obsidian's toggleClass: this runs under the vitest DOM stub
	// too, which patches createEl/addClass but not toggleClass.
	const update = (value: string): void => {
		note.classList.toggle("qa-literal-format-note--shown", value.includes("{{"));
	};

	update(initialValue);
	return update;
}
