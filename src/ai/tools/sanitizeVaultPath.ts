/**
 * Validates model-chosen vault paths for the AI built-in writers, a security
 * boundary. Normalizes here, in a fixed order, rather than through Obsidian's
 * `normalizePath`. The dot-segment floor is structural and checked at every
 * depth, so `.git`, `.obsidian` and casing variants are caught anywhere; do not
 * replace it with a name denylist. Writers must also run the realpath
 * containment check in utils/vaultWriteGuards.ts.
 */
import {
	INVALID_FOLDER_CHARS_REGEX,
	INVALID_FOLDER_CONTROL_CHARS_REGEX,
	INVALID_FOLDER_TRAILING_CHARS_REGEX,
	isReservedWindowsDeviceName,
} from "../../utils/pathValidation";
import { isUnderAllowedRoot, normalizeAllowedRoots } from "./allowedRoots";

export class UnsafeVaultPathError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "UnsafeVaultPathError";
	}
}

interface SanitizeVaultPathOptions {
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

	const normalized = slashed.replace(/\/+/g, "/").replace(/^\/+|\/+$/g, "");
	const segments = normalized.split("/").filter((s) => s.length > 0);
	if (segments.length === 0) {
		throw new UnsafeVaultPathError("Path is empty after normalization.");
	}

	for (const segment of segments) {
		if (segment === "." || segment === "..") {
			throw new UnsafeVaultPathError(
				`Refusing path with a traversal segment ("${segment}"): "${normalized}".`,
			);
		}
		// Structural, not a name denylist, so .obsidian/.git/.trash and casing
		// variants are all caught.
		if (segment.startsWith(".")) {
			throw new UnsafeVaultPathError(
				`Refusing to write into a dot/config path segment ("${segment}"): "${normalized}".`,
			);
		}
		validateSegment(segment, normalized);
	}

	const allowed = normalizeAllowedRoots(options.allowedRoots);

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
	// The guard above already rejects a trailing '.' or ' ', so no trim is needed
	// (one would backtrack quadratically on long dot/space runs).
	const base = segment.split(".")[0] ?? "";
	if (base && isReservedWindowsDeviceName(base)) {
		throw new UnsafeVaultPathError(
			`Path segment "${segment}" is a reserved device name: "${fullPath}".`,
		);
	}
}

