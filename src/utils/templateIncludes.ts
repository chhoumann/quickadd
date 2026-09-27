import { TEMPLATE_REGEX } from "../constants";

/**
 * `{{TEMPLATE:path}}` includes inside a format string or a template's content.
 *
 * The formatter resolves the path as a vault path (getTemplateFile), so a
 * package that carries the including choice/template has to carry the included
 * file too, and an import that writes that file somewhere else has to rewrite
 * the token. These two helpers are the single home for reading and rewriting
 * the token; they never touch the vault.
 */

function includeRegex(): RegExp {
	// TEMPLATE_REGEX is a non-global, case-insensitive matcher used by the
	// formatter's one-at-a-time replace loop. Scanning needs every occurrence.
	return new RegExp(TEMPLATE_REGEX.source, "gi");
}

/** Every distinct `{{TEMPLATE:...}}` path in `content`, in first-seen order. */
export function collectTemplateIncludePaths(content: string): Set<string> {
	const paths = new Set<string>();
	if (!content) return paths;
	const re = includeRegex();
	let match: RegExpExecArray | null;
	while ((match = re.exec(content)) !== null) {
		if (match[1]) paths.add(match[1]);
	}
	return paths;
}

/**
 * Rewrite `{{TEMPLATE:old}}` to `{{TEMPLATE:new}}` for every path present in
 * `pathOverrides`. Tokens whose path is not overridden are left byte-for-byte
 * as they were, so content without includes passes through unchanged.
 */
export function rewriteTemplateIncludes(
	content: string,
	pathOverrides: ReadonlyMap<string, string>,
): string {
	if (!content || pathOverrides.size === 0) return content;
	return content.replace(includeRegex(), (token: string, path: string) => {
		const replacement = pathOverrides.get(path);
		return replacement ? `{{TEMPLATE:${replacement}}}` : token;
	});
}
