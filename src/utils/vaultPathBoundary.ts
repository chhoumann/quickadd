/**
 * Lexical vault-boundary checks for untrusted package paths. escapesVaultBoundary
 * lets the preview skip an `adapter.exists` probe outside the vault without
 * throwing or touching the filesystem. The absolute-path check must run before
 * Obsidian's `normalizePath`, which strips leading slashes ("/etc/passwd" would
 * become the in-vault "etc/passwd"). Unlike the write validator, in-vault config
 * dirs are allowed here: probing them is harmless.
 */

// Not exported: each primitive is only safe in the fixed order
// escapesVaultBoundary applies it.

/** Trims and converts backslashes, keeping absolute and traversal markers for the checks below. */
function toSlashedPath(rawPath: string): string {
	return (rawPath ?? "").trim().replace(/\\/g, "/");
}

/** POSIX-absolute (including UNC "//host/share"), drive ("C:/x") and drive-relative ("C:x") paths. */
function isAbsoluteVaultPath(slashedPath: string): boolean {
	return slashedPath.startsWith("/") || /^[a-zA-Z]:/.test(slashedPath);
}

/**
 * True if any segment is ".." followed only by dots or spaces: Win32 strips
 * trailing dots and spaces from each component, so ".. " and "..." open the
 * parent. Fails closed on POSIX pure-dot names too; do not narrow this to
 * spaces only.
 */
function hasTraversalSegment(slashedPath: string): boolean {
	return slashedPath
		.split("/")
		.some((segment) => /^\.\.[. ]*$/u.test(segment));
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

type AssetDestinationProblem = "empty" | "absolute" | "traversal" | "config";

/**
 * Why import would refuse to write an asset where it asks to, or null when it
 * may: the path must be non-blank, in-vault, free of traversal (including the
 * Win32 trailing-dot/space collapse), and free of hidden/config segments (a
 * lone "..%" name stays a literal filename). The import service's
 * `validateAssetDestination` turns the answer into its error.
 */
export function assetDestinationProblem(
	rawPath: string,
): AssetDestinationProblem | null {
	const slashed = toSlashedPath(rawPath);
	if (!slashed) return "empty";
	if (isAbsoluteVaultPath(slashed)) return "absolute";
	if (hasTraversalSegment(slashed)) return "traversal";
	const hasConfigSegment = slashed
		.split("/")
		.some((segment) => segment.startsWith(".") && !segment.startsWith("..%"));
	return hasConfigSegment ? "config" : null;
}

/** Would import write an asset where it asks to? See {@link assetDestinationProblem}. */
export function isWritableAssetDestination(rawPath: string): boolean {
	return assetDestinationProblem(rawPath) === null;
}
