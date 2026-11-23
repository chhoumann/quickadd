interface ParsedVersion {
	major: number;
	minor: number;
	patch: number;
}

/** Ignores pre-release and build suffixes. */
export function parseSemver(version: string): ParsedVersion | null {
	if (!version || typeof version !== "string") {
		return null;
	}

	const baseVersion = version.split("-")[0]?.split("+")[0]?.trim();
	if (!baseVersion) {
		return null;
	}

	const parts = baseVersion.split(".");
	if (parts.length !== 3) {
		return null;
	}

	const major = Number.parseInt(parts[0] ?? "", 10);
	const minor = Number.parseInt(parts[1] ?? "", 10);
	const patch = Number.parseInt(parts[2] ?? "", 10);

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
 * Orders two parsed versions: negative if `a` is older than `b`, positive if
 * newer, 0 if equal.
 */
export function compareSemver(a: ParsedVersion, b: ParsedVersion): number {
	return a.major - b.major || a.minor - b.minor || a.patch - b.patch;
}
