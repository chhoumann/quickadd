/**
 * Unified path normalization utility for consistent cross-platform path handling.
 * Ensures all path operations use the same normalization rules.
 */
export class PathNormalizer {
	/**
	 * Normalizes a path for consistent comparison across platforms.
	 * - Converts backslashes to forward slashes (Windows compatibility)
	 * - Removes trailing slashes
	 * - Handles empty/null paths safely
	 */
	static normalize(path: string): string {
		if (!path) {
			return "";
		}

		// Convert backslashes to forward slashes and remove trailing slashes
		return path.replace(/\\+/g, "/").replace(/\/+$/, "");
	}

	/**
	 * Checks if a path is valid (non-empty after normalization).
	 */
	static isValidPath(path: string): boolean {
		if (!path || typeof path !== "string") {
			return false;
		}
		return this.normalize(path.trim()).length > 0;
	}

	/**
	 * Determines if a path looks like a file path (has an extension).
	 * This is a heuristic and should be used in conjunction with file system checks.
	 */
	static isFilePath(path: string): boolean {
		if (!path) {
			return false;
		}

		const normalized = this.normalize(path);
		const lastSegment = normalized.split("/").pop();
		
		// Check if the last segment has an extension
		return lastSegment ? lastSegment.includes(".") : false;
	}

	/**
	 * Determines if a path looks like a folder path (no extension in last segment).
	 * This is a heuristic and should be used in conjunction with file system checks.
	 */
	static isFolderPath(path: string): boolean {
		if (!path) {
			return false;
		}

		return !this.isFilePath(path);
	}

	/**
	 * Checks if two paths are equivalent after normalization.
	 */
	static arePathsEquivalent(path1: string, path2: string): boolean {
		return this.normalize(path1) === this.normalize(path2);
	}

	/**
	 * Checks if a path is a subfolder of another path.
	 */
	static isSubfolderOf(childPath: string, parentPath: string): boolean {
		const normalizedChild = this.normalize(childPath);
		const normalizedParent = this.normalize(parentPath);
		
		if (normalizedParent === "") {
			return true; // Everything is a subfolder of root
		}
		
		return normalizedChild.startsWith(normalizedParent + "/");
	}
}