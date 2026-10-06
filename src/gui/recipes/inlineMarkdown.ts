import { docsUrl } from "../../docs";

/**
 * The inline Markdown a package manifest's install lines use: `code`,
 * **bold**, and [links](/docs/...) whose target is site-relative or https.
 */
export type InlineSegment =
	| { kind: "text"; text: string }
	| { kind: "code"; text: string }
	| { kind: "bold"; children: InlineSegment[] }
	| { kind: "link"; href: string; children: InlineSegment[] };

const INLINE = /`([^`]+)`|\*\*(.+?)\*\*|\[((?:[^\]`]|`[^`]*`)+)\]\(([^)\s]+)\)/g;

function linkTarget(target: string): string | null {
	if (target.startsWith("/")) return docsUrl(target);
	return /^https:\/\//.test(target) ? target : null;
}

export function parseInline(line: string): InlineSegment[] {
	const segments: InlineSegment[] = [];
	let last = 0;
	for (const match of line.matchAll(INLINE)) {
		const index = match.index ?? 0;
		if (index > last) segments.push({ kind: "text", text: line.slice(last, index) });
		const [whole, code, bold, linkText, target] = match;
		if (code !== undefined) segments.push({ kind: "code", text: code });
		else if (bold !== undefined) segments.push({ kind: "bold", children: parseInline(bold) });
		else {
			const href = linkTarget(target);
			segments.push(href ? { kind: "link", href, children: parseInline(linkText) } : { kind: "text", text: whole });
		}
		last = index + whole.length;
	}
	if (last < line.length) segments.push({ kind: "text", text: line.slice(last) });
	return segments;
}
