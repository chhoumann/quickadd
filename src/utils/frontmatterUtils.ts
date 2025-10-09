const FRONTMATTER_OPEN = /^-{3}\s*$/;
const FRONTMATTER_CLOSE = /^(?:-{3}|\.\.\.)\s*$/;

/**
 * Determines the zero-based line index of the closing frontmatter delimiter.
 * Returns null when no valid YAML frontmatter block is present at the top of the content.
 */
export function getFrontmatterEndLine(content: string): number | null {
  if (!content) return null;

  const normalized = content.replace(/^\uFEFF/, "");
  const lines = normalized.split(/\r?\n/);
  if (lines.length === 0) return null;

  if (!FRONTMATTER_OPEN.test(lines[0].trim())) return null;

  for (let i = 1; i < lines.length; i += 1) {
    if (FRONTMATTER_CLOSE.test(lines[i].trim())) {
      return i;
    }
  }

  return null;
}
