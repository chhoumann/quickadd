import { findYamlFrontMatterRange, getYamlContextForMatch } from "./yamlContext";

/**
 * Pure helpers for issue #757 `|type:text` quoting.
 *
 * A value typed into a `{{VALUE:x|type:text}}` prompt is written raw-inline into
 * front matter, where Obsidian's YAML parser would otherwise retype or break it:
 * `0042` -> the number 42, `true` -> a boolean, `#todo` -> a comment (null),
 * `[a]` -> a list, `a: b` -> invalid YAML, and so on. Wrapping the value in a
 * double-quoted scalar guarantees it stays the exact string the user entered.
 */

/**
 * Wrap a value in a YAML double-quoted scalar, escaping `\`, `"`, and control
 * characters. VALUE tokens typed in the UI are single-line, but a value can be
 * seeded programmatically (script/CLI), so newlines/tabs are escaped to keep
 * the emitted scalar valid YAML.
 */
export function quoteYamlDouble(value: string): string {
	const escaped = value
		.replace(/\\/g, "\\\\")
		.replace(/"/g, '\\"')
		.replace(/\n/g, "\\n")
		.replace(/\r/g, "\\r")
		.replace(/\t/g, "\\t");
	return `"${escaped}"`;
}

/**
 * Whether a `|type:text` VALUE at [matchStart, matchEnd) should be written as a
 * quoted YAML scalar. True only when the token is the SOLE value at a front
 * matter key:value or list-item position and the author has not already quoted
 * it — so quoting never corrupts body prose or a partially quoted value.
 *
 * We quote unconditionally at that position (not only for coercion-prone values)
 * because YAML has many indicator characters (`#`, `[`, `{`, `*`, `&`, `!`, …)
 * that silently retype or break an unquoted string; a single static predicate
 * for "safe plain scalar" is error-prone, while quoting is always correct.
 */
/**
 * Escape a value that is being substituted INSIDE an author-quoted front matter
 * scalar (`key: "{{VALUE:x}}"` / `- '{{FIELD:y}}'`). Authors quote tokens so the
 * raw template stays valid YAML (Obsidian's parser warns on bare `{{...}}`,
 * issue #1655); without escaping, a value containing the surrounding quote
 * character corrupts the created note's front matter. Applies only when the
 * token exactly spans the quoted scalar at a sole-value position - everywhere
 * else the value passes through untouched.
 */
export function escapeValueInsideQuotedYamlScalar(
	input: string,
	matchStart: number,
	matchEnd: number,
	value: string,
): string {
	const ctx = getYamlContextForMatch(
		input,
		matchStart,
		matchEnd,
		findYamlFrontMatterRange(input),
	);
	if (!ctx.isInYaml || !ctx.isQuoted) return value;
	if (!ctx.isKeyValuePosition && !ctx.isListItemPosition) return value;

	if (input[matchStart - 1] === '"') {
		return value
			.replace(/\\/g, "\\\\")
			.replace(/"/g, '\\"')
			.replace(/\n/g, "\\n")
			.replace(/\r/g, "\\r")
			.replace(/\t/g, "\\t");
	}
	// Single-quoted YAML has exactly one escape: '' for a literal apostrophe.
	return value.replace(/'/g, "''");
}

export function shouldQuoteTextScalar(
	input: string,
	matchStart: number,
	matchEnd: number,
): boolean {
	const ctx = getYamlContextForMatch(
		input,
		matchStart,
		matchEnd,
		findYamlFrontMatterRange(input),
	);
	if (!ctx.isInYaml || ctx.isQuoted) return false;
	return ctx.isKeyValuePosition || ctx.isListItemPosition;
}
