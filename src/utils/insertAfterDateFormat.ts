/**
 * Extract a moment date format from a `{{DATE:fmt}}` / `{{VDATE:name,fmt}}` token
 * in an ordered capture's "insert after" text, so an ordered date log can
 * auto-detect its sort format. Returns undefined for a bare `{{DATE}}`, a
 * literal-`+` format, or a multi-token heading — those can't be reliably
 * round-tripped, so the UI falls back to insertion + a warning.
 *
 * The DATE regex mirrors DATE_REGEX_FORMATTED: the snap option (`|startof:`/
 * `|endof:` + letters, issue #511) is excluded from the captured sort format,
 * while any other literal `|` is preserved ({{DATE:YYYY|MM}} -> "YYYY|MM").
 */
export function detectDateFormatFromAfter(after: string): string | undefined {
	const date = after.match(
		/\{\{DATE:((?:[^}\n\r+|]|\|(?!(?:startof|endof):[a-z]))*)(?:\+-?\d+)?(?:\|(?:startof|endof):[a-z]+)?\}\}/i,
	);
	const dateFormat = date?.[1]?.trim();
	if (dateFormat) return dateFormat;
	// VDATE is {{VDATE:name,format}} or {{VDATE:name,format|default}} — drop the
	// "|default"/"|startof:..." segment so it doesn't leak into the moment parse
	// format (the VDATE format itself never contains a literal pipe).
	const vdate = after.match(/\{\{VDATE:[^,}]+,([^}\n\r]*)\}\}/i);
	const vdateFormat = vdate?.[1]?.split("|")[0]?.trim();
	if (vdateFormat) return vdateFormat;
	return undefined;
}
