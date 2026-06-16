/**
 * Pure helpers for issue #757 type-aware YAML quoting.
 *
 * A value typed into a `{{VALUE}}` prompt is written raw-inline into a note's
 * frontmatter; Obsidian's YAML parser then COERCES certain unquoted strings
 * into Number/Boolean/null, silently changing a text value's type — e.g.
 * `id: 0042` becomes the number 42, `flag: true` becomes a boolean. When the
 * target property should stay text, wrapping the value in a double-quoted YAML
 * scalar keeps it a string.
 *
 * The coercion set below was pinned EMPIRICALLY against Obsidian's own parser
 * (a live metadataCache probe), NOT against the YAML 1.1 spec — they differ.
 * Obsidian keeps these as STRINGS (so they are intentionally NOT quoted):
 *   - YAML 1.1 booleans yes / no / on / off (and YES, Off, ...)
 *   - integers with underscores (1_000)
 *   - dates and date-times (2025-12-25, 2025-12-25T15:30, 12:30)
 *   - binary (0b101), mixed-case bool/null (tRue), incomplete forms (0x, 1e)
 * Obsidian coerces these to non-strings (so they ARE quoted when the property
 * is text): true/True/TRUE, false/False/FALSE, null/Null/NULL/~, signed
 * decimals/floats/scientific (incl. leading-zero 0042), hex 0x.., octal 0o..,
 * and .inf/.nan.
 */

// true / True / TRUE / false / False / FALSE — NOT mixed case (tRue stays text).
const YAML_BOOL = /^(?:true|True|TRUE|false|False|FALSE)$/;
// null / Null / NULL / ~
const YAML_NULL = /^(?:null|Null|NULL|~)$/;
// Signed decimal int + float: 42, -7, +5, 0042, 3.5, .5, 5., 1e3, 2e10.
// Also matches plain integers (the `[0-9]+` alternative), which is intended.
const YAML_FLOAT = /^[-+]?(?:\.[0-9]+|[0-9]+(?:\.[0-9]*)?)(?:[eE][-+]?[0-9]+)?$/;
const YAML_HEX = /^[-+]?0x[0-9a-fA-F]+$/;
const YAML_OCT = /^[-+]?0o[0-7]+$/;
const YAML_INFNAN = /^[-+]?\.(?:inf|Inf|INF|nan|NaN|NAN)$/;

/**
 * Whether Obsidian's YAML parser would turn this exact string into a
 * non-string (Number/Boolean/null) when written unquoted as a scalar value.
 */
export function wouldYamlMisCoerce(value: string): boolean {
	const s = value.trim();
	if (!s) return false;
	return (
		YAML_BOOL.test(s) ||
		YAML_NULL.test(s) ||
		YAML_FLOAT.test(s) ||
		YAML_HEX.test(s) ||
		YAML_OCT.test(s) ||
		YAML_INFNAN.test(s)
	);
}

/**
 * Wrap a value in a YAML double-quoted scalar, escaping `\` and `"`. VALUE
 * tokens can never contain newlines (the variable regex forbids them), so no
 * other escaping is required.
 */
export function quoteYamlDouble(value: string): string {
	return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}
