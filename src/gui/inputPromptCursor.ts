import type { InputPromptOptions } from "../types/inputPrompt";

type PromptInputEl = HTMLInputElement | HTMLTextAreaElement;

export function positionInputPromptCursor(
	inputEl: PromptInputEl,
	options?: InputPromptOptions,
) {
	inputEl.focus();

	if (options?.cursorAtEnd) {
		const cursorPosition = inputEl.value.length;
		inputEl.setSelectionRange(cursorPosition, cursorPosition);
		return;
	}

	inputEl.select();
}
