export interface InputPromptOptions {
	cursorAtEnd?: boolean;
	/** Token carries |optional: show a Skip button and accept empty submissions as the answer. */
	optional?: boolean;
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
