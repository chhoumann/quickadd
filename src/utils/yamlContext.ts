export type YamlRange = [number, number] | null;

export interface YamlMatchContext {
  isInYaml: boolean;
  isQuoted: boolean;
  lineStart: number;
  lineEnd: number;
  baseIndent: string;
  isKeyValuePosition: boolean;
}

/** Finds the YAML front matter range. Returns [start, end] or null. */
export function findYamlFrontMatterRange(input: string): YamlRange {
  const frontMatterRegex = /^(\s*---\r?\n)([\s\S]*?)(\r?\n(?:---|\.\.\.)\s*(?:\r?\n|$))/;
  const match = frontMatterRegex.exec(input);
  if (!match) return null;
  return [0, match[0].length];
}

/**
 * Determines if a placeholder lies within YAML and in a key-value position.
 */
export function getYamlContextForMatch(
  input: string,
  matchStart: number,
  matchEnd: number,
  yamlRange: YamlRange,
): YamlMatchContext {
  const isInYaml = yamlRange !== null && matchStart >= yamlRange[0]! && matchStart <= yamlRange[1]!;
  if (!isInYaml) {
    return {
      isInYaml: false,
      isQuoted: false,
      lineStart: 0,
      lineEnd: 0,
      baseIndent: "",
      isKeyValuePosition: false,
    };
  }

  const lineStart = input.lastIndexOf("\n", matchStart - 1) + 1;
  const lineEndIdx = input.indexOf("\n", matchStart);
  const lineEnd = lineEndIdx === -1 ? input.length : lineEndIdx;

  const before = input.slice(lineStart, matchStart);
  const after = input.slice(matchEnd, lineEnd);

  const baseIndent = (before.match(/^\s*/) || [""])[0];

  const isQuoted =
    (input[matchStart - 1] === '"' && input[matchEnd] === '"') ||
    (input[matchStart - 1] === "'" && input[matchEnd] === "'");

  const beforeTrimmed = before.replace(/["']$/, "");
  const afterTrimmed = after.replace(/^["']/, "");
  const isKeyValuePosition = /:\s*$/.test(beforeTrimmed) && afterTrimmed.trim().length === 0;

  return {
    isInYaml: true,
    isQuoted,
    lineStart,
    lineEnd,
    baseIndent,
    isKeyValuePosition,
  };
}
