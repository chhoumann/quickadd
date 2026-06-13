import type { App } from "obsidian";
import { Notice } from "obsidian";

/**
 * Shows a notice to the user when no user scripts are found in their vault.
 * Provides helpful guidance on where to place scripts and links to documentation.
 */
export function showNoScriptsFoundNotice(app: App): void {
	const notice = new Notice("", 10000);
	const messageEl = notice.messageEl;
	messageEl.replaceChildren();
	appendDiv(messageEl, "No scripts found", "quickadd-notice-title");

	// Use the notice element's owning document (popout-aware) instead of the bare
	// `document` global.
	const doc = messageEl.ownerDocument;
	const content = doc.createElement("div");
	messageEl.append(content);
	appendDiv(
		content,
		"QuickAdd cannot find any .js files or notes with a ```js code block in your vault.",
	);
	content.append(doc.createElement("br"));
	appendDiv(content, "Please make sure your scripts are:");
	appendDiv(content, `✓ In your vault (not in ${app.vault.configDir} folder)`);
	appendDiv(content, "✓ Not in hidden folders (starting with a dot)");
	appendDiv(
		content,
		"✓ A .js file, or a note containing a ```js code block",
	);
	content.append(doc.createElement("br"));

	const link = doc.createElement("a");
	link.textContent = "View documentation";
	link.href = "https://quickadd.obsidian.guide/docs/Choices/MacroChoice#user-scripts";
	link.target = "_blank";
	link.rel = "noopener noreferrer";
	link.classList.add("quickadd-notice-link");
	content.append(link);
}

function appendDiv(parent: HTMLElement, text: string, cls?: string): HTMLDivElement {
	const element = parent.ownerDocument.createElement("div");
	element.textContent = text;
	if (cls) element.classList.add(cls);
	parent.append(element);
	return element;
}
