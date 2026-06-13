import { normalizePath } from 'obsidian';

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
