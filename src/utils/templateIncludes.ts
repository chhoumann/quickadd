/**
 * `{{TEMPLATE:path}}` includes inside a format string or a template's content.
 *
 * The formatter resolves the path as a vault path (getTemplateFile), so a
 * package that carries the including choice/template has to carry the included
 * file too, and an import that writes that file somewhere else has to rewrite
 * the token. These helpers are the single home for reading and rewriting the
 * token; they never touch the vault.
 *
 * The scanner mirrors TEMPLATE_REGEX (`{{TEMPLATE:([^\n\r}]*\.(?:md|canvas|base))}}`,
 * case-insensitive) but runs in linear time. The regex's greedy path class
 * cannot cross a `}` or a line break, so the only candidate for a token's end
 * is the first such character after its prefix; when that candidate fails,
 * every `{{TEMPLATE:` prefix before it fails the same way. A global regex
 * retries each of those prefixes and rescans to the same terminator, which is
 * quadratic on a crafted line — and a package preview reads bundled notes the
 * reader has not vetted yet.
 */

const TOKEN_PREFIX = "{{TEMPLATE:";
const TOKEN_PREFIX_REGEX = /{{TEMPLATE:/gi;
const INCLUDE_EXTENSION_REGEX = /\.(?:md|canvas|base)$/i;

interface IncludeToken {
	/** Offset of the token's first `{`. */
	start: number;
	/** Offset just past the closing `}}`. */
	end: number;
	/** The path as the formatter resolves it: trimmed, no leading slash. */
	path: string;
}

/**
 * Normalize a captured path exactly the way getTemplateFile does before the
 * vault lookup, so `{{TEMPLATE: /Templates/X.md}}` and `Templates/X.md` name
 * the same bundled asset.
 */
function normalizeIncludePath(raw: string): string {
	return raw.trim().replace(/^\/+/, "");
}

function scanTemplateIncludes(content: string): IncludeToken[] {
	const tokens: IncludeToken[] = [];
	const prefix = new RegExp(TOKEN_PREFIX_REGEX.source, "gi");
	let searchFrom = 0;
	while (searchFrom < content.length) {
		prefix.lastIndex = searchFrom;
		const found = prefix.exec(content);
		if (!found) break;
		const start = found.index;
		const pathStart = start + TOKEN_PREFIX.length;
		let terminator = pathStart;
		while (terminator < content.length) {
			const ch = content[terminator];
			if (ch === "}" || ch === "\n" || ch === "\r") break;
			terminator++;
		}
		const rawPath = content.slice(pathStart, terminator);
		const closes =
			content[terminator] === "}" && content[terminator + 1] === "}";
		if (closes && INCLUDE_EXTENSION_REGEX.test(rawPath)) {
			tokens.push({
				start,
				end: terminator + 2,
				path: normalizeIncludePath(rawPath),
			});
			searchFrom = terminator + 2;
		} else {
			// No prefix between here and the terminator can do better.
			searchFrom = terminator;
		}
	}
	return tokens;
}

/** Every distinct `{{TEMPLATE:...}}` path in `content`, in first-seen order. */
export function collectTemplateIncludePaths(content: string): Set<string> {
	const paths = new Set<string>();
	if (!content) return paths;
	for (const token of scanTemplateIncludes(content)) {
		if (token.path) paths.add(token.path);
	}
	return paths;
}

/**
 * Rewrite `{{TEMPLATE:old}}` to `{{TEMPLATE:new}}` for every path present in
 * `pathOverrides` (keyed by normalized path). Tokens whose path is not
 * overridden are left byte-for-byte as they were, so content without includes
 * passes through unchanged.
 */
export function rewriteTemplateIncludes(
	content: string,
	pathOverrides: ReadonlyMap<string, string>,
): string {
	if (!content || pathOverrides.size === 0) return content;
	const tokens = scanTemplateIncludes(content);
	if (tokens.length === 0) return content;
	let output = "";
	let cursor = 0;
	for (const token of tokens) {
		const replacement = pathOverrides.get(token.path);
		if (!replacement) continue;
		output += content.slice(cursor, token.start);
		output += `${TOKEN_PREFIX}${replacement}}}`;
		cursor = token.end;
	}
	if (cursor === 0) return content;
	return output + content.slice(cursor);
}
