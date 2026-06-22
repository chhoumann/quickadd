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
 * Decodes a percent-encoded Markdown link target for use inside a wiki embed.
 *
 * Markdown links percent-encode the path (e.g. spaces become `%20`), but a wiki
 * embed resolves only against the literal vault path, so `A%20B.md` must become
 * `A B.md`. The catch: a wiki embed has no escape for its structural separators
 * `#` (heading), `^` (block) and `|` (alias). Decoding a *percent-encoded* one
 * (a literal occurrence in the path) into a bare delimiter would silently
 * re-target the embed, so those escapes are left encoded. A *literal* `#` that
 * Obsidian already emitted as a real heading separator is preserved untouched.
 * Falls back to the raw target when it is not valid percent-encoding (e.g. a
 * lone `%`), so malformed input never throws.
 */
function decodeWikiEmbedTarget(target: string): string {
	const RESERVED = /%(23|5e|7c)/gi; // # ^ |
	// A NUL sentinel never occurs in a vault path, so it cannot collide with
	// real content on restore. Strip the `%` off the reserved escapes (replacing
	// it with the sentinel) so decodeURIComponent leaves them intact, then restore.
	const SENTINEL = "\x00";
	const masked = target.replace(RESERVED, (_match, hex) => `${SENTINEL}${hex}`);
	let decoded: string;
	try {
		decoded = decodeURIComponent(masked);
	} catch {
		return target;
	}
	return decoded.replace(
		new RegExp(`${SENTINEL}(23|5e|7c)`, "gi"),
		(_match, hex) => `%${hex}`,
	);
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
		return `![[${decodeWikiEmbedTarget(markdownTarget)}]]`;
	}

	return link.startsWith("!") ? link : `!${link}`;
}
