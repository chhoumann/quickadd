/**
 * Path sanitization for AI-built-in vault writers (#714).
 *
 * The model chooses the path a built-in write tool targets, so this is a security
 * boundary. Modeled on `validateAssetDestination` (packageImportService.ts) but
 * HARDENED per the v5 review:
 *
 *  - Normalization is done HERE (deterministic, no dependency on Obsidian's
 *    `normalizePath`, whose test stub is incomplete) and in a fixed order:
 *    trim → backslash→'/' → NFC → reject absolute → collapse '//' + strip slashes.
 *  - The leading-dot config-dir floor is checked on EVERY segment at ANY depth
 *    (the precedent checked only segments[0], so `Projects/.git/hooks/x` and
 *    `notes/.obsidian/plugins/x` slipped through — an RCE-on-next-commit /
 *    plugin-drop vector). It is a STRUCTURAL rule (segment starts with '.'), which
 *    is inherently immune to the `.Obsidian`/`.OBSIDIAN` casing bypass — do not
 *    replace it with a case-sensitive name denylist.
 *
 * This module is PURE (no Obsidian import) so it is fully unit-testable. The
 * symlink / realpath-containment check that writers MUST also perform needs the
 * FileSystemAdapter and lives with the writers (see builtins/vaultWriteGuards.ts).
 */
import {
	INVALID_FOLDER_CHARS_REGEX,
	INVALID_FOLDER_CONTROL_CHARS_REGEX,
	INVALID_FOLDER_TRAILING_CHARS_REGEX,
	isReservedWindowsDeviceName,
} from "../../utils/pathValidation";

export class UnsafeVaultPathError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "UnsafeVaultPathError";
	}
}

export interface SanitizeVaultPathOptions {
	/**
	 * If provided (and non-empty after dropping blank entries), the path must
	 * resolve under one of these vault-relative folders. Absent / all-blank =>
	 * vault-wide (the default). A blank entry NEVER becomes allow-all.
	 */
	allowedRoots?: string[];
}

/**
 * Validate + normalize a model-chosen vault-relative path. Throws
 * UnsafeVaultPathError on anything unsafe. Returns the normalized relative path
 * (forward slashes, no leading/trailing slash). Does NOT touch the filesystem.
 */
export function sanitizeVaultPath(
	rawPath: string,
	options: SanitizeVaultPathOptions = {},
): string {
	const trimmed = (rawPath ?? "").trim();
	if (!trimmed) {
		throw new UnsafeVaultPathError("Path is empty.");
	}

	// 1. Backslash → '/' FIRST (turns UNC `\\server\share` into `//server/share`,
	//    so the absolute check below catches it).
	const slashed = trimmed.replace(/\\/g, "/").normalize("NFC");

	// 2. Reject absolute paths (POSIX root and Windows drive letters) BEFORE
	//    collapsing — `normalizePath` strips leading slashes, which would hide them.
	if (slashed.startsWith("/") || /^[a-zA-Z]:/.test(slashed)) {
		throw new UnsafeVaultPathError(
			`Refusing to write to an absolute path outside the vault: "${slashed}".`,
		);
	}

	// 3. Collapse repeated slashes and strip leading/trailing slashes.
	const normalized = slashed.replace(/\/+/g, "/").replace(/^\/+|\/+$/g, "");
	const segments = normalized.split("/").filter((s) => s.length > 0);
	if (segments.length === 0) {
		throw new UnsafeVaultPathError("Path is empty after normalization.");
	}

	for (const segment of segments) {
		// Traversal.
		if (segment === "." || segment === "..") {
			throw new UnsafeVaultPathError(
				`Refusing path with a traversal segment ("${segment}"): "${normalized}".`,
			);
		}
		// Config-dir / dotfile FLOOR — every segment, any depth, structural (not a
		// name denylist), so .obsidian/.git/.trash and casing variants are all caught.
		if (segment.startsWith(".")) {
			throw new UnsafeVaultPathError(
				`Refusing to write into a dot/config path segment ("${segment}"): "${normalized}".`,
			);
		}
		// Per-segment character / device-name validation (incl. the basename).
		validateSegment(segment, normalized);
	}

	const allowed = (options.allowedRoots ?? [])
		.map((root) => normalizeRoot(root))
		.filter((root) => root.length > 0);

	if (allowed.length > 0 && !isUnderAllowedRoot(normalized, allowed)) {
		throw new UnsafeVaultPathError(
			`Path "${normalized}" is not under an allowed root (${allowed.join(", ")}).`,
		);
	}

	return normalized;
}

function validateSegment(segment: string, fullPath: string): void {
	if (INVALID_FOLDER_CONTROL_CHARS_REGEX.test(segment)) {
		throw new UnsafeVaultPathError(
			`Path segment "${segment}" contains control characters: "${fullPath}".`,
		);
	}
	// '/' is already consumed by the split; the rest of the class (\\ : * ? " < > |) still applies.
	if (INVALID_FOLDER_CHARS_REGEX.test(segment)) {
		throw new UnsafeVaultPathError(
			`Path segment "${segment}" contains an illegal character (\\ : * ? " < > |): "${fullPath}".`,
		);
	}
	if (INVALID_FOLDER_TRAILING_CHARS_REGEX.test(segment)) {
		throw new UnsafeVaultPathError(
			`Path segment "${segment}" cannot end with a space or a period: "${fullPath}".`,
		);
	}
	const base = segment.replace(/[. ]+$/u, "").split(".")[0] ?? "";
	if (base && isReservedWindowsDeviceName(base)) {
		throw new UnsafeVaultPathError(
			`Path segment "${segment}" is a reserved device name: "${fullPath}".`,
		);
	}
}

function normalizeRoot(root: string): string {
	return (root ?? "")
		.trim()
		.replace(/\\/g, "/")
		.replace(/\/+/g, "/")
		.replace(/^\/+|\/+$/g, "");
}

function isUnderAllowedRoot(path: string, roots: string[]): boolean {
	return roots.some((root) => path === root || path.startsWith(`${root}/`));
}
