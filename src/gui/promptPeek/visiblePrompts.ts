/**
 * The QuickAdd prompt modals currently on screen. A parked peek must not
 * resume while another prompt is up - remounting one modal over another
 * steals focus mid-typing and stacks two prompts - so the peek session
 * consults this before returning.
 */
const visible = new Set<object>();

export function markPromptVisible(prompt: object): void {
	visible.add(prompt);
}

export function markPromptHidden(prompt: object): void {
	visible.delete(prompt);
}

export function hasVisiblePrompt(): boolean {
	return visible.size > 0;
}

/** Forget every tracked prompt; for teardown in tests. */
export function clearVisiblePrompts(): void {
	visible.clear();
}
