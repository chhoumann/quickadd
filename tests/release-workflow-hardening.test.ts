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
// steps being reordered). Full-line comments are dropped first so a guard that
// is COMMENTED OUT (e.g. `# persist-credentials: false`) cannot satisfy a check.
function stepBlocks(content: string): string[] {
	const lines = content.split("\n").filter((line) => !/^\s*#/.test(line));
	const blocks: string[] = [];
	let current: string[] = [];
	for (const line of lines) {
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
		// write it into .git/config where untrusted install/build/test code could read
		// it. Anchored to real YAML lines so a commented-out guard cannot pass.
		expect(checkout).toMatch(
			/^\s*token:\s*\$\{\{\s*steps\.app-token\.outputs\.token\s*\}\}\s*$/m,
		);
		expect(checkout).toMatch(/^\s*persist-credentials:\s*false\s*$/m);
	});

	it("scopes the minted App token to exactly the least-privilege set", () => {
		const appToken = stepContaining("uses: actions/create-github-app-token@");
		// Collect every permission-* input declared on the step (comments already
		// stripped by stepBlocks).
		const permissions: Record<string, string> = {};
		for (const line of appToken.split("\n")) {
			const match = line.match(/^\s*(permission-[a-z-]+):\s*(\S+)\s*$/);
			if (match) permissions[match[1]] = match[2];
		}
		// Without explicit permission-* inputs the token inherits ALL of the App's
		// installation permissions. Assert the list is CLOSED: exactly these three
		// scopes (push commit/tag + create Release; comment on issues/PRs) and
		// nothing broader - a future over-permission addition must fail this test.
		expect(permissions).toEqual({
			"permission-contents": "write",
			"permission-issues": "write",
			"permission-pull-requests": "write",
		});
	});
});
