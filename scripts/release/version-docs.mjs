import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const STABLE_VERSION_REGEX = /^\d+\.\d+\.\d+$/;

function fail(message) {
	console.error(`[docs-versioning] ${message}`);
	process.exit(1);
}

const version = process.argv[2];

if (!version) {
	fail("Missing version argument.");
}

if (!STABLE_VERSION_REGEX.test(version)) {
	fail(`Version "${version}" is not a stable X.Y.Z release.`);
}

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, "..", "..");
const docsDir = path.join(repoRoot, "docs");
const versionedDocsDir = path.join(
	docsDir,
	"versioned_docs",
	`version-${version}`,
);

if (!existsSync(docsDir)) {
	fail(`Docs directory not found: ${docsDir}`);
}

if (existsSync(versionedDocsDir)) {
	console.log(
		`[docs-versioning] Snapshot already exists for ${version}. Skipping.`,
	);
	process.exit(0);
}

console.log(`[docs-versioning] Creating docs snapshot for ${version}.`);

try {
	execFileSync("bun", ["run", "docusaurus", "docs:version", version], {
		cwd: docsDir,
		stdio: "inherit",
	});
} catch (error) {
	const message = error instanceof Error ? error.message : String(error);
	fail(`Failed to snapshot docs for ${version}: ${message}`);
}

console.log(`[docs-versioning] Snapshot completed for ${version}.`);
