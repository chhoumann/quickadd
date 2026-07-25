/**
 * Renders the muted line under a prompt's title that says which choice is
 * asking and where the answer lands (issue #1546). Shared by the input-prompt
 * modals, which do not share a base class: `GenericWideInputPrompt` extends
 * `Modal` directly and duplicates `display()`.
 *
 * `fullText` (the same line with the destination path un-elided) becomes the
 * hover tooltip: the line is clipped to one row and long paths are shortened,
 * so a narrow modal would otherwise leave no way to read the whole path.
 */
export function renderPromptContextLine(
	container: HTMLElement,
	contextLine: string | undefined,
	fullText?: string,
): HTMLElement | undefined {
	const text = contextLine?.trim();
	if (!text) return undefined;

	const el = container.createDiv({
		text,
		cls: "qa-prompt-context",
	});
	const tooltip = fullText?.trim() || text;
	if (tooltip !== text) el.setAttr("title", tooltip);
	return el;
}
