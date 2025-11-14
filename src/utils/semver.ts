/**
 * Semantic version parsing and comparison utilities.
 * Handles standard semver format (major.minor.patch) with optional pre-release
 * and build metadata suffixes (e.g., "2.7.0-beta.1", "2.7.0+123").
 */

export interface ParsedVersion {
	major: number;
	minor: number;
	patch: number;
}

/**
 * Parses a semantic version string into its components.
 * Handles versions with pre-release and build metadata suffixes by ignoring them.
 *
 * @param version - Version string (e.g., "2.7.0", "2.7.0-beta.1", "2.7.0+123")
 * @returns Parsed version object or null if the version string is invalid
 *
 * @example
 * parseSemver("2.7.0") // { major: 2, minor: 7, patch: 0 }
 * parseSemver("2.7.0-beta.1") // { major: 2, minor: 7, patch: 0 }
 * parseSemver("invalid") // null
 */
export function parseSemver(version: string): ParsedVersion | null {
	if (!version || typeof version !== "string") {
		return null;
	}

	// Remove pre-release and build metadata suffixes
	// e.g., "2.7.0-beta.1" -> "2.7.0", "2.7.0+123" -> "2.7.0"
	const baseVersion = version.split("-")[0]?.split("+")[0]?.trim();
	if (!baseVersion) {
		return null;
	}

	// Split into parts and parse numeric components
	const parts = baseVersion.split(".");
	if (parts.length !== 3) {
		return null;
	}

	const major = Number.parseInt(parts[0] ?? "", 10);
	const minor = Number.parseInt(parts[1] ?? "", 10);
	const patch = Number.parseInt(parts[2] ?? "", 10);

	// Validate that all parts are valid numbers
	if (
		Number.isNaN(major) ||
		Number.isNaN(minor) ||
		Number.isNaN(patch) ||
		major < 0 ||
		minor < 0 ||
		patch < 0
	) {
		return null;
	}

	return { major, minor, patch };
}

/**
 * Determines if an update from previousVersion to currentVersion is a major version bump.
 * A major update occurs when the major version number increases.
 *
 * @param currentVersion - The new version string
 * @param previousVersion - The previous version string
 * @returns true if it's a major update, false otherwise. Returns true if either version
 *          cannot be parsed (to err on the side of showing updates when uncertain).
 *
 * @example
 * isMajorUpdate("3.0.0", "2.7.0") // true
 * isMajorUpdate("2.8.0", "2.7.0") // false
 * isMajorUpdate("2.7.0", "invalid") // true (shows update when uncertain)
 */
export function isMajorUpdate(
	currentVersion: string,
	previousVersion: string,
): boolean {
	const current = parseSemver(currentVersion);
	const previous = parseSemver(previousVersion);

	// If either version is invalid, default to showing the update
	// This ensures users don't miss important updates due to parsing issues
	if (!current || !previous) {
		return true;
	}

	return current.major > previous.major;
}

