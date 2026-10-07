import { findInlineScriptSpans } from "./inlineScriptSpans";

/**
 * A `{{...}}` span. Tokens are single-line and never hold a brace, and the one
 * quantified class excludes both braces, so each `{{` opener is scanned once.
 */
const TOKEN_SPAN = /{{[^{}\n\r]*}}/g;

const decodeTokens = (text: string): string =>
	text.replace(TOKEN_SPAN, (token) => token.split("\\|").join("|"));

/**
 * `\|` inside a `{{...}}` token reads as `|`. A Markdown table cell needs its
 * pipe escaped, so a token with a pipe option can only be written this way
 * there. Text outside tokens keeps its `\|` for the table, and inline script
 * fences are code, so they are copied verbatim.
 */
export function unescapePipesInTokens(input: string): string {
	if (!input.includes("\\|")) return input;

	let output = "";
	let index = 0;
	for (const span of findInlineScriptSpans(input)) {
		output += decodeTokens(input.slice(index, span.start));
		output += input.slice(span.start, span.end);
		index = span.end;
	}
	return output + decodeTokens(input.slice(index));
}
