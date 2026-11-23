type YamlRange = [number, number] | null;

interface YamlMatchContext {
  isInYaml: boolean;
  isQuoted: boolean;
  lineStart: number;
  lineEnd: number;
  baseIndent: string;
  isKeyValuePosition: boolean;
  /**
   * True when the match is the SOLE value of a YAML list item, i.e. the line is
   * `- {{match}}` (optionally indented / wrapped in quotes). Mirrors
   * isKeyValuePosition for the `- value` shape so a consumer can tell a list
   * item value apart from prose that merely starts with a dash.
   */
  isListItemPosition: boolean;
  /**
   * True when the match is one whole item of a YAML flow sequence, as in
   * `key: [a, {{match}}]` or a multi-line flow sequence (the item may be author-quoted).
   */
  isFlowListItemPosition: boolean;
}

function isYamlSpace(char: string | undefined): boolean {
  return char === " " || char === "\t" || char === "\r" || char === "\n" || char === undefined;
}

function skipDoubleQuoted(text: string, start: number, end: number): number {
  let i = start + 1;
  while (i < end) {
    if (text[i] === "\\") {
      i += 2;
    } else if (text[i] === '"') {
      return i + 1;
    } else {
      i++;
    }
  }
  return end;
}

function skipSingleQuoted(text: string, start: number, end: number): number {
  let i = start + 1;
  while (i < end) {
    if (text[i] === "'") {
      if (text[i + 1] === "'") {
        i += 2;
      } else {
        return i + 1;
      }
    } else {
      i++;
    }
  }
  return end;
}

function skipToLineEnd(text: string, start: number, end: number): number {
  const nl = text.indexOf("\n", start);
  return nl === -1 || nl >= end ? end : nl + 1;
}

function skipWhitespaceAndComments(text: string, start: number, end: number): number {
  let i = start;
  while (i < end) {
    const char = text[i];
    if (char === " " || char === "\t" || char === "\r" || char === "\n") {
      i++;
    } else if (char === "#" && (i === start || isYamlSpace(text[i - 1]))) {
      i = skipToLineEnd(text, i, end);
    } else {
      break;
    }
  }
  return i;
}

function isBlockScalarHeader(lineRest: string): boolean {
  const trimmed = lineRest.replace(/\s+#.*$/, "").trim();
  return /^[|>][+-]?\d*[+-]?$/.test(trimmed);
}

function findBlockMappingColon(text: string, start: number, lineEnd: number): number {
  let i = start;
  if (text[i] === '"') {
    i = skipDoubleQuoted(text, i, lineEnd);
    while (i < lineEnd && (text[i] === " " || text[i] === "\t")) i++;
    return i < lineEnd && text[i] === ":" && isYamlSpace(text[i + 1]) ? i : -1;
  }
  if (text[i] === "'") {
    i = skipSingleQuoted(text, i, lineEnd);
    while (i < lineEnd && (text[i] === " " || text[i] === "\t")) i++;
    return i < lineEnd && text[i] === ":" && isYamlSpace(text[i + 1]) ? i : -1;
  }
  while (i < lineEnd) {
    const char = text[i];
    if (char === "#" && i > start && isYamlSpace(text[i - 1])) return -1;
    if (char === ":" && isYamlSpace(text[i + 1])) return i;
    i++;
  }
  return -1;
}

function yamlBodyBounds(input: string, yamlRange: [number, number]): [number, number] | null {
  const [yamlStart, yamlEnd] = yamlRange;
  const firstNl = input.indexOf("\n", yamlStart);
  if (firstNl === -1 || firstNl >= yamlEnd) return null;
  const bodyStart = firstNl + 1;
  const closing = /\r?\n(?:---|\.\.\.)\s*(?:\r?\n|$)/.exec(input.slice(bodyStart, yamlEnd));
  if (!closing) return null;
  return [bodyStart, bodyStart + closing.index];
}

function isWholeFlowListItem(
  input: string,
  tokenStart: number,
  tokenEnd: number,
  yamlRange: [number, number],
): boolean {
  const bounds = yamlBodyBounds(input, yamlRange);
  if (!bounds) return false;
  const [bodyStart, bodyEnd] = bounds;
  if (tokenStart < bodyStart || tokenEnd > bodyEnd) return false;

  const afterToken = skipWhitespaceAndComments(input, tokenEnd, bodyEnd);
  if (afterToken >= bodyEnd || (input[afterToken] !== "," && input[afterToken] !== "]")) {
    return false;
  }

  const flowStack: Array<"[" | "{"> = [];
  let atValueStart = true;
  let blockScalarIndent: number | null = null;
  let plainScalarIndent: number | null = null;
  let i = bodyStart;

  while (i < tokenStart) {
    if (flowStack.length === 0) {
      const lineStart = i;
      const nl = input.indexOf("\n", lineStart);
      const rawLineEnd = nl === -1 || nl > bodyEnd ? bodyEnd : nl;
      const lineEnd = rawLineEnd > lineStart && input[rawLineEnd - 1] === "\r" ? rawLineEnd - 1 : rawLineEnd;
      const nextLine = nl === -1 || nl + 1 > bodyEnd ? bodyEnd : nl + 1;

      let cursor = lineStart;
      while (cursor < lineEnd && input[cursor] === " ") cursor++;
      const indent = cursor - lineStart;
      while (cursor < lineEnd && (input[cursor] === " " || input[cursor] === "\t")) cursor++;

      if (blockScalarIndent !== null) {
        if (cursor === lineEnd || indent > blockScalarIndent) {
          i = nextLine;
          continue;
        }
        blockScalarIndent = null;
      }

      if (plainScalarIndent !== null) {
        if (cursor === lineEnd || (indent > plainScalarIndent && input[cursor] !== "#")) {
          i = nextLine;
          continue;
        }
        plainScalarIndent = null;
      }

      if (cursor === lineEnd || input[cursor] === "#") {
        i = nextLine;
        continue;
      }

      let ownerIndent = indent;
      while (cursor < lineEnd && input[cursor] === "-" && isYamlSpace(input[cursor + 1])) {
        ownerIndent = cursor - lineStart;
        cursor++;
        while (cursor < lineEnd && (input[cursor] === " " || input[cursor] === "\t")) cursor++;
      }

      const colon = findBlockMappingColon(input, cursor, lineEnd);
      if (colon !== -1) {
        ownerIndent = cursor - lineStart;
        cursor = colon + 1;
        while (cursor < lineEnd && (input[cursor] === " " || input[cursor] === "\t")) cursor++;
      }

      if (cursor >= lineEnd || input[cursor] === "#") {
        i = nextLine;
        continue;
      }

      const first = input[cursor];
      if (first === "[" || (first === "{" && input[cursor + 1] !== "{")) {
        if (cursor >= tokenStart) return false;
        flowStack.push(first);
        atValueStart = true;
        i = cursor + 1;
        continue;
      }
      if (first === '"') {
        i = skipDoubleQuoted(input, cursor, bodyEnd);
        continue;
      }
      if (first === "'") {
        i = skipSingleQuoted(input, cursor, bodyEnd);
        continue;
      }
      if ((first === "|" || first === ">") && isBlockScalarHeader(input.slice(cursor, lineEnd))) {
        blockScalarIndent = ownerIndent;
        i = nextLine;
        continue;
      }
      plainScalarIndent = ownerIndent;
      i = nextLine;
      continue;
    }

    const char = input[i];
    if (char === " " || char === "\t" || char === "\r" || char === "\n") {
      i++;
      continue;
    }
    if (char === "#" && (i === bodyStart || isYamlSpace(input[i - 1]))) {
      i = skipToLineEnd(input, i, bodyEnd);
      continue;
    }
    if (char === "{" && input[i + 1] === "{") {
      const close = input.indexOf("}}", i + 2);
      if (close !== -1 && close + 2 <= tokenStart) {
        i = close + 2;
        atValueStart = false;
        continue;
      }
    }
    if (atValueStart && char === '"') {
      i = skipDoubleQuoted(input, i, bodyEnd);
      atValueStart = false;
      continue;
    }
    if (atValueStart && char === "'") {
      i = skipSingleQuoted(input, i, bodyEnd);
      atValueStart = false;
      continue;
    }
    if (char === "[" || char === "{") {
      flowStack.push(char);
      atValueStart = true;
      i++;
      continue;
    }
    if (char === "]") {
      if (flowStack.pop() !== "[") return false;
      atValueStart = false;
      i++;
      continue;
    }
    if (char === "}") {
      if (flowStack.pop() !== "{") return false;
      atValueStart = false;
      i++;
      continue;
    }
    if (char === ",") {
      atValueStart = true;
      i++;
      continue;
    }
    if (char === ":" && flowStack[flowStack.length - 1] === "{" && isYamlSpace(input[i + 1])) {
      atValueStart = true;
      i++;
      continue;
    }
    atValueStart = false;
    i++;
  }

  return i === tokenStart && flowStack[flowStack.length - 1] === "[" && atValueStart;
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
  const [yamlStart, yamlEnd] = yamlRange ?? [Number.NaN, Number.NaN];
  const isInYaml = yamlRange !== null && matchStart >= yamlStart && matchStart < yamlEnd;
  if (!isInYaml) {
    return {
      isInYaml: false,
      isQuoted: false,
      lineStart: 0,
      lineEnd: 0,
      baseIndent: "",
      isKeyValuePosition: false,
      isListItemPosition: false,
      isFlowListItemPosition: false,
    };
  }

  const lineStart = input.lastIndexOf("\n", matchStart - 1) + 1;
	// A match may span several lines, as an inline `js quickadd` fence does.
	// Find the end of the line containing the match's END so sole-value checks
	// can see a suffix after the closing fence. Using matchStart here silently
	// treated `key: <multiline match> suffix` as a sole property value.
	const lineEndIdx = input.indexOf("\n", Math.max(matchStart, matchEnd));
  const lineEnd = lineEndIdx === -1 ? input.length : lineEndIdx;

  const before = input.slice(lineStart, matchStart);
  const after = input.slice(matchEnd, lineEnd);

  const baseIndent = (before.match(/^\s*/) || [""])[0];

  const isQuoted =
    (input[matchStart - 1] === '"' && input[matchEnd] === '"') ||
    (input[matchStart - 1] === "'" && input[matchEnd] === "'");

  const beforeTrimmed = before.replace(/["']$/, "");
  const afterTrimmed = after.replace(/^["']/, "");
  // A trailing YAML comment (` #…`) is not part of the scalar, so a token
  // followed only by a comment is still the sole value of its key / list item.
  const afterIsSoleValue =
    afterTrimmed.replace(/\s+#.*$/, "").trim().length === 0;
  const isKeyValuePosition = /:\s*$/.test(beforeTrimmed) && afterIsSoleValue;
  // `- {{match}}` (optionally indented / quoted) and nothing else on the line.
  const isListItemPosition = /^\s*-\s*$/.test(beforeTrimmed) && afterIsSoleValue;
  const tokenStart = isQuoted ? matchStart - 1 : matchStart;
  const tokenEnd = isQuoted ? matchEnd + 1 : matchEnd;
  const isFlowListItemPosition = isWholeFlowListItem(input, tokenStart, tokenEnd, [yamlStart, yamlEnd]);

  return {
    isInYaml: true,
    isQuoted,
    lineStart,
    lineEnd,
    baseIndent,
    isKeyValuePosition,
    isListItemPosition,
    isFlowListItemPosition,
  };
}
