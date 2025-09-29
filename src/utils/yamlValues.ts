/** Converts QuickAdd internal value encodings to types preferred by Obsidian YAML. */
export function coerceYamlValue(v: unknown): unknown {
  if (typeof v === "string" && v.startsWith("@date:")) {
    const iso = v.substring(6);
    const d = new Date(iso);
    if (!Number.isNaN(d.getTime())) return d;
  }
  return v;
}
