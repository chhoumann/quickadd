import { decodeEscapedCharacters } from "./variableParsingUtils";

export type VariableHint = ListVariableHint | UnknownVariableHint;

export interface ListVariableHint {
  kind: "list";
  options: ListHintOptions;
}

export interface UnknownVariableHint {
  kind: "unknown";
  raw: string;
}

export interface ListHintOptions {
  /**
   * Optional delimiter override. When provided, takes precedence over strategy heuristics.
   */
  delimiter?: string;
  /**
   * Parsing strategy hint. "csv" prefers comma splitting, "newline" forces line-based splitting.
   */
  strategy?: "auto" | "csv" | "newline";
}

export interface VariableNameSpec {
  /** The raw canonical token exactly as written in the template (after trimming). */
  canonical: string;
  /** The base variable identifier before any @hint suffix. */
  base: string;
  /** Parsed hint directives (currently @list only). */
  hints: VariableHint[];
  /** True when the token represents an anonymous option list (e.g., {{VALUE:low,medium}}). */
  isOptionList: boolean;
  /** Pre-parsed suggestion values for anonymous option lists. */
  suggestions: string[];
}

const HINT_PATTERN = /^([a-zA-Z0-9_-]+)(?:\((.*)\))?$/;

export function parseVariableNameSpec(raw: string): VariableNameSpec {
  const canonical = raw.trim();
  const hasHintSuffix = canonical.includes("@");
  const hasComma = canonical.includes(",");

  if (!hasHintSuffix && hasComma) {
    const suggestions = canonical
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean);

    return {
      canonical,
      base: canonical,
      hints: [],
      isOptionList: true,
      suggestions,
    };
  }

  const [baseSegment, ...hintSegments] = canonical.split("@");
  const base = baseSegment.trim();
  const hints: VariableHint[] = hintSegments
    .map((segment) => segment.trim())
    .filter(Boolean)
    .map(parseHint);

  return {
    canonical,
    base,
    hints,
    isOptionList: false,
    suggestions: [],
  };
}

function parseHint(segment: string): VariableHint {
  const match = HINT_PATTERN.exec(segment);
  if (!match) {
    return { kind: "unknown", raw: segment };
  }

  const [, name, arg] = match;
  const normalizedName = name.toLowerCase();

  if (normalizedName === "list") {
    return {
      kind: "list",
      options: parseListOptions(arg ?? ""),
    };
  }

  return { kind: "unknown", raw: segment };
}

function parseListOptions(arg: string): ListHintOptions {
  const options: ListHintOptions = { strategy: "auto" };
  const trimmed = arg.trim();
  if (!trimmed) return options;

  const lower = trimmed.toLowerCase();

  switch (lower) {
    case "csv":
    case ",":
    case "comma":
      options.strategy = "csv";
      return options;
    case "newline":
    case "lines":
    case "line":
    case "\\n":
    case "\n":
      options.strategy = "newline";
      return options;
    case "semicolon":
    case ";":
      options.delimiter = ";";
      return options;
    case "pipe":
    case "|":
      options.delimiter = "|";
      return options;
    default:
      break;
  }

  const parts = trimmed
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);

  for (const part of parts) {
    const [key, value] = part.split("=").map((token) => token.trim());
    if (!value) {
      // Treat naked value as delimiter override (allowing escaped sequences like \n)
      options.delimiter = decodeEscapedCharacters(part);
      continue;
    }

    switch (key.toLowerCase()) {
      case "delimiter":
      case "delim":
        options.delimiter = decodeEscapedCharacters(value);
        break;
      case "strategy":
      case "mode":
        if (value === "csv" || value === "newline" || value === "auto") {
          options.strategy = value;
        }
        break;
      default:
        break;
    }
  }

  return options;
}
