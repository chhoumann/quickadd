export interface CursorPosition {
	line: number;
	ch: number;
}

export interface CursorInfo {
	position: number;  // Position in the string
	index: number;     // Cursor index (for multiple cursors)
}

export interface FormattedContentWithCursor {
	content: string;
	cursorPosition?: CursorPosition;
}