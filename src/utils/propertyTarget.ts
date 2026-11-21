import { parseFilterSegments, type FieldFilter } from "./FieldSuggestionParser";
import { splitPipeParts } from "./pipeSyntax";

/**
 * A parsed "Capture to" frontmatter-property target (issue #466). Mirrors the
 * `#tag` capture target, but pre-filters notes by a frontmatter field/value:
 *
 *   property:type=draft     → notes whose frontmatter `type` equals `draft`
 *   property:type           → notes that HAVE a `type` field (presence mode)
 *   property:type=draft|folder:Notes|exclude-tag:archived
 *                           → equality + the shared {{FILE}}/{{FIELD}} pipe filters
 *
 * The `property:` prefix is matched case-insensitively (like the `#` sigil) and
 * survives the engine's `formatFileName` pass, so the value may even carry format
 * tokens (`property:type={{VALUE}}`) that resolve before classification.
 *
 * `|` is RESERVED for the pipe-filter grammar (parsed by {@link parseFilterSegments},
 * exactly as `{{FILE:}}` does), so a literal `|` cannot appear in a property value.
 */
interface PropertyTarget {
	/** Frontmatter field name (case-insensitively matched at query time). May be "" when malformed. */
	field: string;
	/** Target value; `undefined` means presence mode (match any value, incl. empty). */
	value?: string;
	/** folder / tag / exclude-* filters from `|pipes`; empty object when none. */
	filter: FieldFilter;
}

const PROPERTY_PREFIX = /^property:/i;

/** Whether a (trimmed) "Capture to" value is a `property:` target. */
export function isPropertyTarget(raw: string): boolean {
	return PROPERTY_PREFIX.test(raw.trim());
}

/**
 * Parse a `property:` capture target. Returns `null` when the value is not a
 * property target at all (no `property:` prefix), so callers fall through to the
 * tag/folder/file resolution. A present-but-malformed target (empty field name)
 * returns `{ field: "" }` so the engine can abort with a clear message rather
 * than silently creating a literal file.
 *
 * This is the SINGLE classifier used by both the capture engine and the one-page
 * preflight, so the two paths can never disagree on what is a property target.
 */
export function parsePropertyTarget(raw: string): PropertyTarget | null {
	const trimmed = raw.trim();
	if (!PROPERTY_PREFIX.test(trimmed)) return null;

	const interior = trimmed.replace(PROPERTY_PREFIX, "");

	// The first pipe part is the `field=value` core; the rest are the shared
	// folder/tag/exclude-* filters, identical to {{FILE:}}/{{FIELD:}}. Only
	// folder / tag / exclude-folder / exclude-tag / exclude-file are honored by
	// the property query (see getMarkdownFilesWithProperty); other FIELD options
	// the grammar accepts (default:/inline:/case-sensitive:) are inert here —
	// value matching is always case-insensitive by design.
	const [core = "", ...segments] = splitPipeParts(interior).map((part) => part.trim());
	const { filters } = parseFilterSegments(segments, { token: trimmed });

	const eq = core.indexOf("=");
	const field = (eq >= 0 ? core.slice(0, eq) : core).trim();
	// Split on the FIRST `=`, so values may contain further `=` (e.g. `a=b`).
	const rawValue = eq >= 0 ? core.slice(eq + 1).trim() : "";
	// Empty value (`property:type` or `property:type=`) → presence mode.
	const value = rawValue.length > 0 ? rawValue : undefined;

	return { field, value, filter: filters };
}
