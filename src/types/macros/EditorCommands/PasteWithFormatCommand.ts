import { type App, htmlToMarkdown } from "obsidian";
import { log } from "../../../logger/logManager";
import { EditorCommand } from "./EditorCommand";
import { EditorCommandType } from "./EditorCommandType";

export class PasteWithFormatCommand extends EditorCommand {
	constructor() {
		super(EditorCommandType.PasteWithFormat);
	}

	static async run(app: App) {
		const activeView = EditorCommand.getActiveMarkdownView(app);

		if (!activeView) {
			log.logError("no active markdown view.");
			return;
		}

		let content = "";

		try {
			// Check if advanced clipboard API is available
			if ("read" in navigator.clipboard && navigator.clipboard.read) {
				const clipboardItems = await navigator.clipboard.read();
				let foundHtml = false;

				// Look for HTML content in clipboard
				for (const item of clipboardItems) {
					if (item.types.includes("text/html")) {
						const htmlBlob = await item.getType("text/html");
						const htmlContent = await htmlBlob.text();
						content = await htmlToMarkdown(htmlContent);
						foundHtml = true;
						break;
					}
				}

				// If no HTML found, fall back to plain text
				if (!foundHtml) {
					content = await navigator.clipboard.readText();
				}
			} else {
				// Fallback for older Electron versions
				content = await navigator.clipboard.readText();
			}

			activeView.editor.replaceSelection(content);
		} catch (error) {
			// Fallback to regular text paste if formatted clipboard reading fails
			log.logWarning(
				`Formatted paste failed. Falling back to plain text: ${error}`
			);
			try {
				const textContent = await navigator.clipboard.readText();
				activeView.editor.replaceSelection(textContent);
			} catch (textError) {
				log.logError(`Failed to read clipboard text: ${textError}`);
			}
		}
	}
}
