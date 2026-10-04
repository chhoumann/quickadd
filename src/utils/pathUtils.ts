import { normalizePath } from 'obsidian';

/**
 * Canonical vault-relative form of a user-supplied path: trimmed, backslashes
 * converted to '/', repeated slashes collapsed, leading and trailing slashes
 * removed, NFC (the form Obsidian stores vault paths in). A blank path, or one
 * of only slashes, yields '' - the vault root.
 */
/**
 * Separator normalization: backslashes to slashes, repeated and edge slashes
 * removed, NFC. Unlike {@link normalizeVaultPath} it keeps leading whitespace,
 * so a folder whose name starts with a space keeps its identity; trailing
 * whitespace is dropped because no vault name can end in it. Use this wherever
 * a path IS something (a root, a destination); use the trimming form for
 * matching typed input against it.
 */
export function normalizeVaultPathSeparators(path: string): string {
  return (path ?? '')
    .replace(/[\\/]+/g, '/')
    .replace(/^\/|\/$/g, '')
    .trimEnd()
    .replace(/\/$/, '')
    .normalize('NFC');
}

export function normalizeVaultPath(path: string): string {
  return (path ?? '')
    .trim()
    .replace(/[\\/]+/g, '/')
    .replace(/^\/|\/$/g, '')
    .normalize('NFC');
}

export function basenameWithoutMdOrCanvas(path: string): string {
  const normalized = normalizePath(path);
  const base = normalized.split('/').pop() ?? '';
  return base.replace(/\.(md|canvas|base)$/i, '');
}

/**
 * Returns the parent folder of a vault file path as a clean vault-relative
 * path (no trailing slash). A file at the vault root yields an empty string.
 */
export function parentFolderPath(path: string): string {
  const normalized = normalizePath(path);
  const slashIndex = normalized.lastIndexOf('/');
  return slashIndex === -1 ? '' : normalized.slice(0, slashIndex);
}
