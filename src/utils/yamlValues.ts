/**
 * `@date:<ISO>` strings, as VDATE answers are stored, become Dates so Obsidian
 * serializes them as YAML dates. Invalid dates stay strings.
 */
export function coerceYamlValue(v: unknown): unknown {
  if (typeof v === "string" && v.startsWith("@date:")) {
    const iso = v.substring(6);

    const d = new Date(iso);

    if (!Number.isNaN(d.getTime())) return d;
  }

  return v;
}

/**
 * Returns whether a value should be written back through Obsidian's YAML
 * processor as a structured property type instead of plain string text.
 */
export function isStructuredYamlValue(v: unknown): boolean {
  return typeof v !== "string" && (
    Array.isArray(v) ||
    (typeof v === "object" && v !== null) ||
    typeof v === "number" ||
    typeof v === "boolean" ||
    v === null
  );
}

/**
 * Returns whether a value is a *container* (array or plain object) — the kinds
 * that produce invalid YAML when inlined as text and therefore must be written
 * through Obsidian's serializer. Scalars (number/boolean/null) are excluded
 * because they are already YAML-safe inline, so collecting them would only force
 * a needless whole-frontmatter rewrite (stripping comments, normalising quotes).
 */
export function isContainerYamlValue(v: unknown): boolean {
  return Array.isArray(v) || (typeof v === "object" && v !== null);
}

/**
 * Produces a YAML-parseable placeholder for structured values so frontmatter
 * stays valid until processFrontMatter rewrites the final value.
 */
export function getYamlPlaceholder(v: unknown): string | undefined {
  if (!isStructuredYamlValue(v)) return undefined;
  if (Array.isArray(v)) return "[]";
  if (v === null) return "null";
  if (typeof v === "object") return "{}";
  return String(v);
}
