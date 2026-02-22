const { execFileSync } = require("node:child_process");
const path = require("node:path");

const STABLE_VERSION_REGEX = /^\d+\.\d+\.\d+$/;
const versionDocsScriptPath = path.resolve(__dirname, "version-docs.mjs");

module.exports = {
	prepare: (_, context) => {
		const { nextRelease, logger } = context;
		const version = nextRelease && nextRelease.version;

		if (!version) {
			logger.log("No release version found. Skipping docs versioning.");
			return;
		}

		if (!STABLE_VERSION_REGEX.test(version)) {
			logger.log(
				`Skipping docs snapshot for non-stable release ${version}.`,
			);
			return;
		}

		logger.log(`Running docs snapshot for stable release ${version}.`);

		try {
			execFileSync(process.execPath, [versionDocsScriptPath, version], {
				cwd: process.cwd(),
				stdio: "inherit",
			});
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			throw new Error(
				`Docs versioning failed for ${version}: ${message}`,
			);
		}
	},
};
