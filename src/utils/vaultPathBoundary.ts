/**
 * Pure lexical vault-boundary checks for untrusted package paths.
 *
 * An imported QuickAdd package is untrusted data; its asset `originalPath` and
 * referenced template/script paths are attacker-controlled strings. The write
 * path confines them with {@link validateAssetDestination} (which throws), but
 * the preview/analysis phase only needs a cheap boolean: "would probing this
 * path's existence escape the vault?". {@link escapesVaultBoundary} answers that
 * without throwing and without touching the filesystem, so callers can skip the
 * `adapter.exists` probe (treating an out-of-vault path as not-present) instead
 * of issuing an `fs.stat` outside the vault boundary.
 *
 * CRITICAL ordering invariant: the absolute-path check runs on the raw string
 * (after backslash→'/') BEFORE any call to Obsidian's `normalizePath`, which
 * strips leading slashes and would silently turn "/etc/passwd" into the in-vault
 * "etc/passwd". This mirrors `sanitizeVaultPath`/`validateAssetDestination`.
 *
 * Unlike the write validator, this does NOT reject in-vault dot/config dirs:
 * probing `.obsidian/x` is in-bounds and harmless, and a legitimate package may
 * reference an existing config-dir file — rejecting it would mislabel a present
 * reference as "missing". The only concern here is escaping the vault.
 */

/** Trim and convert backslashes to '/'. Does NOT resolve '.'/'..' or strip
 * slashes, so absolute/traversal markers survive for the checks below. */
export function toSlashedPath(rawPath: string): string {
	return (rawPath ?? "").trim().replace(/\\/g, "/");
}

/** True for POSIX-absolute ("/x", and backslash-normalized UNC "//host/share"),
 * Windows drive ("C:\\x" → "C:/x") and drive-relative ("C:x") paths. Expects a
 * backslash-normalized string (see {@link toSlashedPath}). */
export function isAbsoluteVaultPath(slashedPath: string): boolean {
	return slashedPath.startsWith("/") || /^[a-zA-Z]:/.test(slashedPath);
}

/** True if any '/'-separated segment is exactly "..", i.e. a path-traversal
 * segment at any depth. ("..%2fevil.md" is a single literal segment, NOT "..".) */
export function hasTraversalSegment(slashedPath: string): boolean {
	return slashedPath.split("/").some((segment) => segment === "..");
}

/**
 * Does this raw (untrusted) path escape the vault boundary? Rejects absolute /
 * drive / UNC paths and any ".." traversal segment; allows in-vault dot-dirs.
 * Pure: no filesystem access, no Obsidian dependency.
 */
export function escapesVaultBoundary(rawPath: string): boolean {
	const slashed = toSlashedPath(rawPath);
	if (!slashed) return false;
	return isAbsoluteVaultPath(slashed) || hasTraversalSegment(slashed);
}
