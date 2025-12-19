import { Notice } from "obsidian";

/**
 * Shows a notice to the user when no JavaScript files are found in their vault.
 * Provides helpful guidance on where to place scripts and links to documentation.
 */
export function showNoScriptsFoundNotice(): void {
	const notice = new Notice("", 10000);
	const messageEl = notice.messageEl ?? notice.containerEl ?? notice.noticeEl;
	messageEl.empty();
	messageEl.createEl("div", {
		text: "No JavaScript files found",
		cls: "quickadd-notice-title",
	});

	const content = messageEl.createDiv();
	content.createEl("div", {
		text: "QuickAdd cannot find any .js files in your vault.",
	});
	content.createEl("br");
	content.createEl("div", { text: "Please make sure your scripts are:" });
	content.createEl("div", {
		text: "✓ In your vault (not in .obsidian folder)",
	});
	content.createEl("div", {
		text: "✓ Not in hidden folders (starting with a dot)",
	});
	content.createEl("div", { text: "✓ Have a .js extension" });
	content.createEl("br");

	const link = content.createEl("a", {
		text: "View documentation",
		href: "https://quickadd.obsidian.guide/docs/Choices/MacroChoice#user-scripts",
	});
	link.target = "_blank";
	link.rel = "noopener noreferrer";
	link.style.color = "var(--interactive-accent)";
	link.style.textDecoration = "underline";
}
