/**
 * Pure helpers for the {{linksection}} format token (issue #387): given the
 * file's headings and the cursor line, build the `#Heading` subpath that makes a
 * link to the current file scroll to the section the cursor is in.
 *
 * Kept App-free and side-effect-free so the heading-selection / disambiguation /
 * sanitization logic is unit-testable without an Obsidian mock. CompleteFormatter
 * maps the metadata cache + editor cursor onto these.
 */

export interface SimpleHeading {
	heading: string;
	level: number;
	/** 0-based line where the heading starts. */
	line: number;
}

/**
 * Neutralizes the characters that would break a `[[File#…]]` heading subpath so
 * the generated link resolves to the right heading. Empirically (issue #387
 * spike): Obsidian's subpath matcher tolerates stray brackets and collapses
 * whitespace, but `#`, `|`, `^`, and `[[…]]` are structural and must be
 * removed/flattened — a heading containing them verbatim resolves to the wrong
 * heading (or none). Wikilinks/embeds collapse to their text, matching how
 * Obsidian indexes the heading anchor.
 */
export function sanitizeHeadingForSubpath(heading: string): string {
	return heading
		.replace(/!\[\[[^\]]*\]\]/g, "") // drop image/file embeds entirely
		.replace(
			/\[\[([^\]|]*?)(?:\|([^\]]*?))?\]\]/g,
			(_m, target, alias) => alias ?? target,
		)
		.replace(/[#|^]/g, " ")
		.replace(/\s+/g, " ")
		.trim();
}

/**
 * The sanitized ancestor chain for a heading: the heading itself preceded by the
 * nearest ancestor of each strictly-smaller level up to level 1. Empty (fully
 * sanitized-away) segments are skipped so the chain never contains "##".
 */
function ancestorChain(
	headings: SimpleHeading[],
	index: number,
): string[] {
	const text = (h: SimpleHeading) => sanitizeHeadingForSubpath(h.heading);
	const segments: string[] = [];
	const self = text(headings[index]);
	if (self) segments.push(self);
	let level = headings[index].level;
	for (let i = index - 1; i >= 0 && level > 1; i--) {
		if (headings[i].level < level) {
			level = headings[i].level;
			const seg = text(headings[i]);
			if (seg) segments.unshift(seg);
		}
	}
	return segments;
}

/**
 * Builds the subpath (`#Heading`, or the disambiguated `#Parent#…#Heading`) for
 * the nearest heading at or above `cursorLine`, or null when none applies (no
 * headings, the cursor is above the first heading, the heading sanitizes empty,
 * or the link would still be ambiguous) — in which case the caller falls back to
 * a plain whole-file link rather than a link that resolves to the wrong place.
 *
 * Obsidian resolves a bare `#Heading` to the FIRST heading with that text, so
 * when the chosen heading's (sanitized) text is not unique we emit the ancestor
 * chain (verified to resolve correctly in the #387 spike). If even the full
 * chain is not unique (e.g. two identical `# A > ## B` structures, or level-1
 * duplicates with no ancestor to add), no subpath can disambiguate, so we return
 * null instead of emitting a link that silently points at the wrong heading.
 */
export function buildSectionSubpath(
	headings: SimpleHeading[],
	cursorLine: number,
): string | null {
	if (headings.length === 0) return null;

	let targetIndex = -1;
	for (let i = 0; i < headings.length; i++) {
		if (headings[i].line <= cursorLine) targetIndex = i;
		else break;
	}
	if (targetIndex === -1) return null; // cursor is above the first heading

	const targetText = sanitizeHeadingForSubpath(headings[targetIndex].heading);
	// A heading that sanitizes to nothing (e.g. "## #") has no usable anchor.
	if (!targetText) return null;

	const isUniqueText = !headings.some(
		(h, i) =>
			i !== targetIndex &&
			sanitizeHeadingForSubpath(h.heading) === targetText,
	);
	if (isUniqueText) return `#${targetText}`;

	const chain = ancestorChain(headings, targetIndex);
	const chainKey = chain.join("#");
	const isUniqueChain = !headings.some(
		(_h, i) => i !== targetIndex && ancestorChain(headings, i).join("#") === chainKey,
	);
	if (!isUniqueChain) return null; // unresolvable → whole-file fallback

	return `#${chainKey}`;
}
