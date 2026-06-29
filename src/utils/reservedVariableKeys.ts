import { RESERVED_VARIABLE_PREFIX } from "../constants";

/**
 * Whether `name` targets QuickAdd's reserved internal-variable namespace
 * (the `__qa.` prefix). These keys drive internal preflight/runtime plumbing
 * (e.g. the resolved capture-target file path), so they must never be accepted
 * from across a trust boundary - an `obsidian://` URI, the CLI, AI tool output,
 * or a synced/imported choice. Trusted in-process plumbing sets them directly.
 *
 * Single source of truth shared by every untrusted-input boundary so a future
 * reserved key cannot regress one guard while the others still allow it.
 */
export function isReservedVariableKey(name: string): boolean {
	return name.startsWith(RESERVED_VARIABLE_PREFIX);
}
