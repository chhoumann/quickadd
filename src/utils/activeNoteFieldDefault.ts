import type { App, TFile } from "obsidian";

/**
 * Resolves the default value for a `{{FIELD:<field>|default-from:active}}` prompt
 * from a frontmatter object (issue #1429). Pure and App-free so it is fully unit
 * testable; {@link resolveActiveNoteFieldDefault} adds the metadata-cache lookup.
 *
 * Returns:
 *  - a trimmed string for a scalar string/number/boolean value,
 *  - a string[] of trimmed scalar entries for a YAML list of scalars,
 *  - `null` for a missing/null property, an empty scalar, an object/map value,
 *    an empty list, or a list of only non-scalar entries.
 *
 * The field name is matched against the frontmatter keys case-sensitively first
 * (mirroring how the vault-wide FIELD collector reads `frontmatter[fieldName]`),
 * then case-insensitively as a fallback — Obsidian Properties are
 * case-insensitive, so `{{FIELD:Project|default-from:active}}` should still
 * inherit a `project:` property. The fallback is scoped to this single
 * active-note read; vault-wide collection stays exact-case and self-consistent.
 */
export function resolveFieldDefaultFromFrontmatter(
	frontmatter: Record<string, unknown> | undefined | null,
	fieldName: string,
): string | string[] | null {
	const key = fieldName.trim();
	if (!key || !frontmatter) return null;

	let raw: unknown = frontmatter[key];
	if (raw === undefined) {
		const lowerKey = key.toLowerCase();
		const match = Object.keys(frontmatter).find(
			(candidate) => candidate.toLowerCase() === lowerKey,
		);
		if (match !== undefined) raw = frontmatter[match];
	}
	if (raw === undefined || raw === null) return null;

	if (Array.isArray(raw)) {
		const values: string[] = [];
		for (const entry of raw) {
			const scalar = scalarToDefaultString(entry);
			if (scalar !== null) values.push(scalar);
		}
		// A list of only null/object entries (or an empty list) yields no default,
		// so the FIELD prompt falls back to normal behavior.
		return values.length > 0 ? values : null;
	}

	return scalarToDefaultString(raw);
}

/**
 * Reads the active note's current frontmatter via the metadata cache and resolves
 * the `default-from:active` default for `fieldName`. Returns `null` when there is
 * no active Markdown file, the file has no frontmatter, or the property does not
 * resolve to a usable scalar/list value (see
 * {@link resolveFieldDefaultFromFrontmatter}). Read-only: it never mutates a file.
 */
export function resolveActiveNoteFieldDefault(
	app: App,
	activeFile: TFile | null | undefined,
	fieldName: string,
): string | string[] | null {
	// Only Markdown notes carry frontmatter properties; a non-md active file (or
	// no active file) means "no active-derived default", matching the issue's
	// "fall back to normal {{FIELD:project}} behavior" rule.
	if (!activeFile || activeFile.extension !== "md") return null;

	const frontmatter = app.metadataCache.getFileCache(activeFile)?.frontmatter;
	return resolveFieldDefaultFromFrontmatter(frontmatter, fieldName);
}

/**
 * Converts a single frontmatter value into a default string when it is a usable
 * scalar (string/number/boolean), or `null` otherwise. Numbers and booleans are
 * stringified ("0", "false"); an empty/whitespace-only string yields `null` so an
 * empty property never becomes a default. Objects, arrays, null, and undefined are
 * rejected (`null`).
 */
function scalarToDefaultString(value: unknown): string | null {
	if (value === undefined || value === null) return null;
	const type = typeof value;
	if (type === "string" || type === "number" || type === "boolean") {
		const text = String(value).trim();
		return text.length > 0 ? text : null;
	}
	// Objects, arrays, and other non-scalars are not valid defaults.
	return null;
}
