export interface InputPromptOptions {
	cursorAtEnd?: boolean;
	/**
	 * Offer Peek so the user can read or select from the open note and come
	 * back to the same draft. Opt in only for prompts that sit on the vault
	 * (choice runs, `quickAddApi.inputPrompt`). Nested settings/builder
	 * prompts keep the parent modal up, so Peek cannot reach the note.
	 */
	allowPeek?: boolean;
	/** Token carries |optional: show a Skip button and accept empty submissions as the answer. */
	optional?: boolean;
	/**
	 * Accept clipboard IMAGE paste: the image is saved as a vault attachment
	 * (via Obsidian's attachment-folder settings) and an embed link is
	 * inserted at the caret. Clipboard text always wins over an image. Set
	 * ONLY for prompts whose value flows into note content as free text -
	 * never for file-name/folder/path prompts, where an embed link would
	 * corrupt the path.
	 */
	imagePaste?: {
		/** Note path the link will live in when known; "" (default) emits vault-root links that resolve from anywhere. */
		sourcePath?: string;
	};
	numeric?: {
		min?: number;
		max?: number;
		step?: number;
	};
	slider?: {
		min: number;
		max: number;
		step: number;
	};
	/**
	 * Muted one-liner under the modal title saying which choice is asking and,
	 * when the engine already knows it, where the answer lands (issue #1546).
	 */
	contextLine?: string;
	/**
	 * {@link contextLine} with the destination path un-elided, shown as the
	 * hover tooltip so the whole path stays reachable on a narrow modal.
	 */
	contextLineFull?: string;
	/**
	 * Stable per-choice discriminator for the input-draft key. The header used to
	 * be the only thing distinguishing one choice's prompt from another's, so two
	 * prompts that now share a derived title (e.g. "Note title") would otherwise
	 * share a draft and pre-fill each other. Also separates two choices that
	 * happen to have the same name.
	 */
	draftScopeId?: string;
}
