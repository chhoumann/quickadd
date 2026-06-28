/**
 * Allowed-roots confinement policy for the AI tool groups (#714).
 *
 * One policy module, two DISTINCT jobs kept deliberately separate so the same
 * normalization is never misapplied across a trust boundary:
 *
 *  - {@link normalizeRoot} canonicalizes a user/config-supplied root STRING
 *    (trim, backslash→'/', collapse + strip slashes, NFC). Roots are untrusted
 *    input, so trimming/rewriting them is correct.
 *
 *  - {@link isWithinAllowedRoots} tests whether an ALREADY-CANONICAL, app-owned
 *    vault path (e.g. Obsidian's `TFile.path`) sits inside the fence. Such a path
 *    is an identity, not raw input: it must NOT be trimmed or have its separators
 *    rewritten (that would let a sibling folder literally named " AI" masquerade
 *    as "AI"). Only its Unicode form is unified (NFC) so it compares equal to an
 *    NFC-normalized root when the user typed/pasted the root in NFD.
 *
 * NFC is safe here (it cannot merge two distinct folders into a bypass): Obsidian
 * already normalizes every vault path to NFC — verified live, an NFD-named folder
 * is reported by `TFile.path` as NFC and `getAbstractFileByPath` matches only the
 * NFC spelling — so canonical-equivalent paths cannot coexist or reach this code
 * un-normalized. Normalizing the (already-NFC) path is thus a no-op for real
 * inputs; normalizing the root only lets an NFD-typed root match its NFC folder.
 *
 * `sanitizeVaultPath` (which validates MODEL-CHOSEN write/read targets) reuses
 * normalizeRoot + isUnderAllowedRoot for its own root check; the workspace tools
 * reuse isWithinAllowedRoots for the active-note/selection fence. Centralizing the
 * logic here is what stops a future tool group from silently re-spelling — and
 * forgetting — confinement (the gap this module closes for the workspace group).
 */

/**
 * Canonicalize a user/config-supplied vault-relative root: trim, backslash→'/',
 * collapse repeated slashes, strip leading/trailing slashes, then NFC so it
 * compares equal to an NFC-normalized path.
 */
export function normalizeRoot(root: string): string {
	return (root ?? "")
		.trim()
		.replace(/\\/g, "/")
		.replace(/\/+/g, "/")
		.replace(/^\/+|\/+$/g, "")
		.normalize("NFC");
}

/**
 * Segment-aware prefix test: is `path` the root itself or under it. Both
 * arguments must already be normalized (see {@link normalizeRoot}); `path` is
 * compared by identity, so callers pass a canonical app-owned path.
 */
export function isUnderAllowedRoot(path: string, roots: string[]): boolean {
	return roots.some((root) => path === root || path.startsWith(`${root}/`));
}

/**
 * Confinement predicate for an ALREADY-EXISTING, app-owned path (the active note
 * or the source file of the editor selection). Answers exactly one question: is
 * this path inside the configured `allowedRoots` fence?
 *
 * An absent OR all-blank `allowedRoots` means vault-wide (no confinement) and is
 * treated identically to passing none. A confined call with an unknown path
 * (undefined) denies — there is no in-fence path to compare against. The path's
 * identity is preserved (NFC only, never trimmed), so a sibling folder whose name
 * merely shares the root's characters cannot slip through.
 */
export function isWithinAllowedRoots(
	path: string | undefined,
	allowedRoots: string[] | undefined,
): boolean {
	const roots = (allowedRoots ?? [])
		.map((root) => normalizeRoot(root))
		.filter((root) => root.length > 0);
	if (roots.length === 0) return true;
	if (!path) return false;
	return isUnderAllowedRoot(path.normalize("NFC"), roots);
}
