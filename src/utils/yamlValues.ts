/**
 * Converts QuickAdd internal value encodings to types preferred by Obsidian YAML.
 *
 * Internal Conventions:
 * - @date:ISO format: Strings starting with "@date:" followed by an ISO 8601 date string
 *   are automatically converted to JavaScript Date objects. This allows QuickAdd to store
 *   dates in a normalized format internally while ensuring they are properly serialized
 *   as YAML dates in the front matter.
 *
 * Usage:
 * - When a VDATE input is collected, it's stored as "@date:2024-01-01T00:00:00Z"
 * - When post-processing front matter, this function converts it to a Date object
 * - Obsidian's YAML processor then serializes the Date as a proper YAML date
 *
 * Example:
 *   Input: "@date:2024-01-15T10:30:00.000Z"
 *   Output: Date object representing 2024-01-15 at 10:30:00 UTC
 *   YAML: 2024-01-15T10:30:00.000Z (or date format based on Obsidian settings)
 *
 * @param v - The value to coerce, typically from a QuickAdd variable
 * @returns The coerced value (Date object if @date: prefix, otherwise original value)
 */
export function coerceYamlValue(v: unknown): unknown {
  // Check if the value is a string with the @date: prefix
  if (typeof v === "string" && v.startsWith("@date:")) {
    // Extract the ISO date string (everything after "@date:")
    const iso = v.substring(6);

    // Attempt to parse as a Date
    const d = new Date(iso);

    // Only return Date if it's valid (not NaN)
    // Invalid dates fall through and return the original string
    if (!Number.isNaN(d.getTime())) return d;
  }

  // Return original value for non-@date: strings and invalid dates
  return v;
}
