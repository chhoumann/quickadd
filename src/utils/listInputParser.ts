import type { ListHintOptions } from "./variableNameParser";

export interface ListParseResult {
  items: string[];
}

/**
 * Converts user-provided strings (or arrays) into normalized list values suitable for YAML lists.
 * Applies heuristics and hint-driven strategies to split values using commas, newlines, or bullet syntax.
 */
export function parseListInput(
  value: unknown,
  options: ListHintOptions = { strategy: "auto" },
): ListParseResult {
  if (Array.isArray(value)) {
    return { items: normalizeArray(value) };
  }

  if (value === null || value === undefined) {
    return { items: [] };
  }

  const stringValue = String(value);
  const normalized = stringValue.replace(/\r\n/g, "\n").trim();
  if (!normalized) return { items: [] };

  const strategy = options.strategy ?? "auto";

  if (options.delimiter) {
    return { items: splitByDelimiter(normalized, options.delimiter) };
  }

  if (strategy === "newline") {
    return { items: splitByNewlines(normalized) };
  }

  if (strategy === "csv") {
    return { items: splitByDelimiterBracketAware(normalized, ",") };
  }

  // JSON array detection (allows scripts to seed defaults like ["a", "b"])
  if (normalized.startsWith("[") && normalized.endsWith("]")) {
    const parsed = safeParseJsonArray(normalized);
    if (parsed) return { items: normalizeArray(parsed) };
  }

  const bulletItems = parseBulletList(normalized);
  if (bulletItems.length > 0) {
    return { items: bulletItems };
  }

  const lines = splitByNewlines(normalized);
  if (lines.length > 1) {
    return { items: lines };
  }

  if (normalized.includes(";")) {
    const items = splitByDelimiter(normalized, ";");
    if (items.length > 1) return { items };
  }

  if (normalized.includes("|")) {
    const items = splitByDelimiterBracketAware(normalized, "|");
    if (items.length > 1) return { items };
  }

  if (normalized.includes(",")) {
    const items = splitByDelimiterBracketAware(normalized, ",");
    if (items.length > 1) return { items };
  }

  // Default: single entry list using the trimmed string
  return { items: [normalized] };
}

export function createListVariable(items: string[]): string[] {
  const normalized = normalizeArray(items);
  const result = [...normalized];

  Object.defineProperty(result, "toString", {
    value: () => normalized.join(", "),
    configurable: true,
    writable: true,
  });

  return result;
}

/**
 * Splits input by delimiter and filters out empty entries.
 * For example, "a, , b" becomes ["a", "b"], not ["a", "", "b"].
 * This ensures clean list output while allowing flexible user input.
 */
function splitByDelimiter(input: string, delimiter: string): string[] {
  const escaped = delimiter.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const regex = new RegExp(`\\s*${escaped}\\s*`);
  return input
    .split(regex)
    .map((item) => item.trim())
    .filter(Boolean);
}

/**
 * Splits input by delimiter while respecting Obsidian bracket syntax.
 * Delimiters inside [[wiki-links]] are ignored to prevent splitting
 * file names like "[[note, part 2]]" into separate items.
 *
 * Examples:
 * - "[[test, a]], [[foo]]" → ["[[test, a]]", "[[foo]]"]
 * - "alpha, beta" → ["alpha", "beta"]
 */
function splitByDelimiterBracketAware(input: string, delimiter: string): string[] {
  const items: string[] = [];
  let current = "";
  let bracketDepth = 0;

  for (let i = 0; i < input.length; i++) {
    const char = input[i];
    const nextChar = input[i + 1];

    // Track opening brackets [[
    if (char === "[" && nextChar === "[") {
      bracketDepth++;
      current += char + nextChar;
      i++; // Skip the next bracket
      continue;
    }

    // Track closing brackets ]]
    if (char === "]" && nextChar === "]") {
      if (bracketDepth > 0) {
        bracketDepth--;
      }
      current += char + nextChar;
      i++; // Skip the next bracket
      continue;
    }

    // Split on delimiter only when not inside brackets
    if (char === delimiter && bracketDepth === 0) {
      const trimmed = current.trim();
      if (trimmed) items.push(trimmed);
      current = "";
      continue;
    }

    current += char;
  }

  // Add the last item
  const trimmed = current.trim();
  if (trimmed) items.push(trimmed);

  return items;
}

function splitByNewlines(input: string): string[] {
  return input
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

function parseBulletList(input: string): string[] {
  const bulletRegex = /^[-*]\s+/;
  const lines = input.split("\n");
  if (lines.length === 0) return [];
  if (!lines.every((line) => bulletRegex.test(line.trim()))) {
    return [];
  }

  return lines
    .map((line) => line.trim().replace(bulletRegex, ""))
    .filter(Boolean);
}

function safeParseJsonArray(input: string): unknown[] | null {
  try {
    const parsed = JSON.parse(input);
    return Array.isArray(parsed) ? parsed : null;
  } catch (
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    _err
  ) {
    return null;
  }
}

function normalizeArray(values: unknown[]): string[] {
  return values
    .map((item) => (item === null || item === undefined ? "" : String(item).trim()))
    .filter(Boolean);
}
