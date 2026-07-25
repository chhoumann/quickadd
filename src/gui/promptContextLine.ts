/**
 * Renders the muted line under a prompt's title that says which choice is
 * asking and where the answer lands (issue #1546). Shared by the input-prompt
 * modals, which do not share a base class: `GenericWideInputPrompt` extends
 * `Modal` directly and duplicates `display()`.
 *
 * The full text is mirrored into `title`/`aria-label` because the line is
 * clipped to one row: a narrow (mobile) modal would otherwise hide the tail of
 * a long destination path with no way to read it.
 */
export function renderPromptContextLine(
	container: HTMLElement,
	contextLine: string | undefined,
): HTMLElement | undefined {
	const text = contextLine?.trim();
	if (!text) return undefined;

	const el = container.createDiv({
		text,
		cls: "qa-prompt-context",
	});
	el.setAttr("title", text);
	el.setAttr("aria-label", text);
	return el;
}
