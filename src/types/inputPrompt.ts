export interface InputPromptOptions {
	cursorAtEnd?: boolean;
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
}
