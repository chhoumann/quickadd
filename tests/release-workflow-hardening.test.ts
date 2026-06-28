import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// These tests pin the security hardening of the privileged Release workflow:
// the minted GitHub App token (a branch-protection bypass actor) must be scoped
// to least privilege and must NOT be persisted into .git/config while untrusted
// dependency install / build / test code runs ahead of semantic-release. They
// fail loudly if a future edit regresses either guard. No YAML dependency is
// available, so we extract the relevant step block textually and assert on it.

const here = path.dirname(fileURLToPath(import.meta.url));
const releaseYmlPath = path.resolve(here, "..", ".github", "workflows", "release.yml");
const releaseYml = fs.readFileSync(releaseYmlPath, "utf8");

// Each step in release.yml begins with a `- name:` list item. Split the file
// into those blocks so an assertion targets exactly one step (and is immune to
// steps being reordered).
function stepBlocks(content: string): string[] {
	const blocks: string[] = [];
	let current: string[] = [];
	for (const line of content.split("\n")) {
		if (/^\s*- name:/.test(line)) {
			if (current.length > 0) blocks.push(current.join("\n"));
			current = [line];
		} else if (current.length > 0) {
			current.push(line);
		}
	}
	if (current.length > 0) blocks.push(current.join("\n"));
	return blocks;
}

function stepContaining(needle: string): string {
	const matches = stepBlocks(releaseYml).filter((block) => block.includes(needle));
	expect(matches, `exactly one step should contain ${needle}`).toHaveLength(1);
	return matches[0];
}

describe("release workflow hardening", () => {
	it("does not persist the App credential to disk during install/build/test", () => {
		const checkout = stepContaining("uses: actions/checkout@");
		// The token is still passed (semantic-release pushes via the GITHUB_TOKEN env
		// on the Release step, but checkout fetches as the App); we just refuse to
		// write it into .git/config where untrusted install/build/test code could read it.
		expect(checkout).toContain("token: ${{ steps.app-token.outputs.token }}");
		expect(checkout).toContain("persist-credentials: false");
	});

	it("scopes the minted App token to least privilege", () => {
		const appToken = stepContaining("uses: actions/create-github-app-token@");
		// Without explicit permission-* inputs the token inherits ALL of the App's
		// installation permissions. These three are the complete set semantic-release
		// uses (push commit/tag + create Release; comment on issues/PRs).
		expect(appToken).toContain("permission-contents: write");
		expect(appToken).toContain("permission-issues: write");
		expect(appToken).toContain("permission-pull-requests: write");
	});
});
