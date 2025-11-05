import { execSync } from "child_process";

/**
 * Gets git information for the current repository.
 * Returns null for each field if git is not available or if there's an error.
 * This should only be called during development builds.
 */
export function getGitInfo() {
	try {
		const branch = execSync("git rev-parse --abbrev-ref HEAD", {
			encoding: "utf8",
		}).trim();

		const commitHash = execSync("git rev-parse --short HEAD", {
			encoding: "utf8",
		}).trim();

		// Check for uncommitted changes (both staged and unstaged)
		const statusOutput = execSync("git status --porcelain", {
			encoding: "utf8",
		}).trim();
		const hasUncommittedChanges = statusOutput.length > 0;

		return {
			branch,
			commitHash,
			hasUncommittedChanges,
		};
	} catch (error) {
		console.warn("Could not retrieve git information:", error.message);
		return {
			branch: null,
			commitHash: null,
			hasUncommittedChanges: null,
		};
	}
}
