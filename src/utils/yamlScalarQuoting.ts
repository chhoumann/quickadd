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

// C0 control characters and DEL, matched via a runtime-built class so the
// source file contains no raw control bytes (they make ripgrep treat the file
// as binary). \n, \r, and \t are escaped before this runs.
const CONTROL_CHAR_REGEX = new RegExp(
	`[${String.fromCharCode(0)}-${String.fromCharCode(31)}${String.fromCharCode(127)}]`,
	"g",
);

/**
 * Escape a string for the inside of a YAML double-quoted scalar: `\`, `"`, and
 * every C0/DEL control character. VALUE tokens typed in the UI are single-line,
 * but a value can be seeded programmatically (script/CLI), so the full control
 * range is escaped to keep the emitted scalar valid YAML.
 */
function escapeYamlDoubleQuotedContent(value: string): string {
	return value
		.replace(/\\/g, "\\\\")
		.replace(/"/g, '\\"')
		.replace(/\n/g, "\\n")
		.replace(/\r/g, "\\r")
		.replace(/\t/g, "\\t")
		.replace(CONTROL_CHAR_REGEX, (c) =>
			`\\x${c.charCodeAt(0).toString(16).padStart(2, "0")}`,
		);
}

/**
 * Wrap a value in a YAML double-quoted scalar, escaping `\`, `"`, and control
 * characters.
 */
export function quoteYamlDouble(value: string): string {
	return `"${escapeYamlDoubleQuotedContent(value)}"`;
}

/**
 * Whether the token at [matchStart, matchEnd) exactly spans an author-quoted
 * sole-value front matter scalar (`key: "{{TOKEN}}"` / `- '{{TOKEN}}'`).
 */
export function isTokenExactlyQuotedYamlScalar(
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
	if (!ctx.isInYaml || !ctx.isQuoted) return false;
	return ctx.isKeyValuePosition || ctx.isListItemPosition;
}

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
	if (!isTokenExactlyQuotedYamlScalar(input, matchStart, matchEnd)) {
		return value;
	}

	if (input[matchStart - 1] === '"') {
		return escapeYamlDoubleQuotedContent(value);
	}
	// Single-quoted YAML has exactly one escape: '' for a literal apostrophe.
	return value.replace(/'/g, "''");
}

/**
 * Whether a `|type:text` VALUE at [matchStart, matchEnd) should be written as a
 * quoted YAML scalar. True only when the token is the SOLE value at a front
 * matter key:value or list-item position and the author has not already quoted
 * it - so quoting never corrupts body prose or a partially quoted value.
 *
 * We quote unconditionally at that position (not only for coercion-prone values)
 * because YAML has many indicator characters (`#`, `[`, `{`, `*`, `&`, `!`, ...)
 * that silently retype or break an unquoted string; a single static predicate
 * for "safe plain scalar" is error-prone, while quoting is always correct.
 */
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
