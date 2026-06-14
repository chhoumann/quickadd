// Pure (Obsidian-free) helpers for manipulating markdown/wiki link text.
// Extracted so they can be unit-tested directly instead of through an
// editor-mutation module's `__test` back-door.

/**
 * Extracts the target path from a markdown-style link.
 * Works with both wiki-style and markdown-style links.
 */
export function extractMarkdownLinkTarget(link: string): string | null {
	const markdownPattern = /^\s*!?\[[^\]]*\]\((.+)\)\s*$/;
	const match = link.match(markdownPattern);
	if (!match) {
		return null;
	}

	let target = match[1].trim();
	if (!target) {
		return null;
	}

	if (target.startsWith("<") && target.endsWith(">")) {
		target = target.slice(1, -1).trim();
	}

	return target;
}

/**
 * Converts a regular link to an embed by adding the embed prefix (!).
 * Works with both wiki-style and markdown-style links.
 */
export function convertLinkToEmbed(link: string): string {
	// Embeds must leverage wiki-style transclusions (`![[...]]`) because Obsidian interprets markdown image syntax (`![...](...)`) as attachment images, not note embeds.
	const trimmed = link.trim();
	if (trimmed.startsWith("![[") && trimmed.includes("]]")) {
		return link;
	}

	const wikiOpenIndex = link.indexOf("[[");
	const wikiCloseIndex = link.indexOf("]]", wikiOpenIndex + 2);
	if (wikiOpenIndex !== -1 && wikiCloseIndex !== -1) {
		const precedingChar = wikiOpenIndex > 0 ? link.charAt(wikiOpenIndex - 1) : "";
		if (precedingChar === "!") {
			return link;
		}
		return `${link.slice(0, wikiOpenIndex)}!${link.slice(wikiOpenIndex)}`;
	}

	const markdownTarget = extractMarkdownLinkTarget(link);
	if (markdownTarget) {
		return `![[${markdownTarget}]]`;
	}

	return link.startsWith("!") ? link : `!${link}`;
}
