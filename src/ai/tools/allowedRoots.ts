/**
 * Allowed-roots confinement for the AI tool groups, as two separate jobs:
 * normalizeAllowedRoots canonicalizes untrusted root strings, while
 * isWithinAllowedRoots tests an app-owned path by identity (NFC only, never
 * trimmed, so a sibling folder named " AI" cannot pass as "AI"). NFC cannot merge
 * distinct folders, because Obsidian already reports every vault path in NFC.
 */

import { normalizeVaultPath } from "../../utils/pathUtils";

/**
 * Canonicalize user/config-supplied roots the way every vault path is, dropping
 * blank ones. An empty result means no confinement (vault-wide).
 */
export function normalizeAllowedRoots(roots: string[] | undefined): string[] {
	return (roots ?? [])
		.map((root) => normalizeVaultPath(root))
		.filter((root) => root.length > 0);
}

/**
 * Segment-aware prefix test: is `path` the root itself or under it. Both
 * arguments must already be normalized (see {@link normalizeAllowedRoots}); `path` is
 * compared by identity, so callers pass a canonical app-owned path.
 */
export function isUnderAllowedRoot(path: string, roots: string[]): boolean {
	return roots.some((root) => path === root || path.startsWith(`${root}/`));
}

/**
 * Confinement for an existing app-owned path (the active note, the selection's
 * source). Absent or all-blank roots mean vault-wide; a confined call with an
 * unknown path denies.
 */
export function isWithinAllowedRoots(
	path: string | undefined,
	allowedRoots: string[] | undefined,
): boolean {
	const roots = normalizeAllowedRoots(allowedRoots);
	if (roots.length === 0) return true;
	if (!path) return false;
	return isUnderAllowedRoot(path.normalize("NFC"), roots);
}
