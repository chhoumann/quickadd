import { type App, MarkdownView, type TFile } from "obsidian";
import { CURSOR_SYNTAX_REGEX } from "../constants";

export interface CursorPosition {
	position: number;
	index: number;
}

/**
 * Converts Templater cursor syntax to QuickAdd cursor syntax
 */
export function convertTemplaterCursorSyntax(content: string): string {
	// Convert tp.file.cursor() and tp.file.cursor(n) to {{cursor}} and {{cursor:n}}
	const templaterCursorRegex = /<%\s*tp\.file\.cursor\((\d*)\)\s*%>/g;
	
	return content.replace(templaterCursorRegex, (match, index) => {
		if (index) {
			return `{{cursor:${index}}}`;
		}
		return "{{cursor}}";
	});
}

/**
 * Finds all cursor positions in the content and returns their positions
 * after removing the cursor syntax
 */
export function findCursorPositions(content: string): { 
	cleanedContent: string; 
	positions: CursorPosition[] 
} {
	const positions: CursorPosition[] = [];
	let offset = 0;
	
	const cleanedContent = content.replace(CURSOR_SYNTAX_REGEX, (match, index, position) => {
		positions.push({
			position: position - offset,
			index: index ? Number.parseInt(index) : 0
		});
		offset += match.length;
		return "";
	});
	
	// Sort positions by index for multiple cursor support
	positions.sort((a, b) => a.index - b.index);
	
	return { cleanedContent, positions };
}

/**
 * Jumps to cursor position in the active editor
 */
export function jumpToCursor(
	app: App, 
	file: TFile, 
	fileContent: string,
	cursorOffset: number
): void {
	const activeView = app.workspace.getActiveViewOfType(MarkdownView);
	
	if (!activeView || activeView.file?.path !== file.path) {
		// File is not active, can't jump to cursor
		return;
	}
	
	const editor = activeView.editor;
	
	// Convert offset to line and ch
	let currentOffset = 0;
	const lines = fileContent.split('\n');
	
	for (let line = 0; line < lines.length; line++) {
		const lineLength = lines[line].length + 1; // +1 for newline
		
		if (currentOffset + lineLength > cursorOffset) {
			const ch = cursorOffset - currentOffset;
			editor.setCursor({ line, ch });
			return;
		}
		
		currentOffset += lineLength;
	}
}

/**
 * Calculates where cursor should be placed in the final file content
 */
export function calculateCursorPosition(
	capturedContent: string,
	fileContent: string,
	insertMode: 'prepend' | 'append' | 'insertAfter',
	insertPosition?: number
): number | null {
	const { cleanedContent: cleanCapture, positions } = findCursorPositions(capturedContent);
	
	if (positions.length === 0) return null;
	
	const cursorPosInCapture = positions[0].position;
	
	switch (insertMode) {
		case 'prepend':
			// Cursor is at the beginning plus offset into captured content
			return cursorPosInCapture;
		
		case 'append':
			// Cursor is at end of file plus offset into captured content
			return fileContent.length + (fileContent.endsWith('\n') ? 0 : 1) + cursorPosInCapture;
		
		case 'insertAfter':
			// Cursor is at insert position plus offset into captured content
			return (insertPosition || 0) + cursorPosInCapture;
		
		default:
			return null;
	}
}