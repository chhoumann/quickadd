import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

const repoRoot = path.resolve(import.meta.dirname, "..");
const runE2E = path.join(repoRoot, ".agents", "run-e2e");
const profileRoot = "/tmp/quickadd-obsidian-e2e";
const runningOnLinux = process.platform === "linux";
const temporaryPaths: string[] = [];

interface ProfileRootState {
	created: boolean;
	entries: string[];
	mode: number;
	uid: number;
	gid: number;
	inode: number;
}

function temporaryDirectory(prefix: string): string {
	const directory = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
	temporaryPaths.push(directory);
	return directory;
}

function profileRootState(created: boolean): ProfileRootState {
	const stats = fs.lstatSync(profileRoot);
	expect(stats.isDirectory()).toBe(true);
	expect(stats.isSymbolicLink()).toBe(false);
	expect(fs.realpathSync(profileRoot)).toBe(profileRoot);
	expect(stats.uid).toBe(process.getuid?.());
	return {
		created,
		entries: fs.readdirSync(profileRoot).sort(),
		mode: stats.mode & 0o777,
		uid: stats.uid,
		gid: stats.gid,
		inode: stats.ino,
	};
}

function prepareProfileRoot(): ProfileRootState {
	if (fs.existsSync(profileRoot)) return profileRootState(false);
	fs.mkdirSync(profileRoot, { mode: 0o700 });
	fs.chmodSync(profileRoot, 0o700);
	const state = profileRootState(true);
	expect(state.mode).toBe(0o700);
	return state;
}

function cleanProfileInstance(instanceName: string, initialState: ProfileRootState): void {
	const instance = path.join(profileRoot, instanceName);
	expect(path.dirname(instance)).toBe(profileRoot);
	fs.rmSync(instance, { recursive: true, force: true });

	const finalState = profileRootState(initialState.created);
	if (initialState.created) {
		expect(finalState).toMatchObject({
			entries: [],
			mode: 0o700,
			uid: initialState.uid,
			gid: initialState.gid,
			inode: initialState.inode,
		});
		fs.rmdirSync(profileRoot);
		expect(fs.existsSync(profileRoot)).toBe(false);
	} else {
		expect(finalState).toEqual(initialState);
	}
}

afterEach(() => {
	for (const temporaryPath of temporaryPaths.splice(0)) {
		fs.rmSync(temporaryPath, { recursive: true, force: true });
	}
});

describe.skipIf(!runningOnLinux)("Amp orb E2E lifecycle", () => {
	it("does not mask a nonzero start that printed valid exports", () => {
		const bin = temporaryDirectory("quickadd-mock-bin-");
		const log = path.join(bin, "calls.log");
		const fakePnpm = `#!/usr/bin/env bash
echo "$*" >> ${JSON.stringify(log)}
if [[ "$*" == *"start:e2e-obsidian"* ]]; then
	cat <<'EOF'
export OBSIDIAN_E2E_VAULT='mock'
export OBSIDIAN_E2E_VAULT_PATH='/tmp/mock-vault'
export QUICKADD_E2E_VAULT='mock'
export QUICKADD_E2E_VAULT_PATH='/tmp/mock-vault'
export OBSIDIAN_E2E_OBSIDIAN_HOME='/tmp/quickadd-obsidian-e2e/mock/home'
export QUICKADD_E2E_OBSIDIAN_HOME='/tmp/quickadd-obsidian-e2e/mock/home'
EOF
	exit 23
fi
exit 0
`;
		fs.writeFileSync(path.join(bin, "pnpm"), fakePnpm, { mode: 0o755 });

		const result = spawnSync(runE2E, [], {
			cwd: os.tmpdir(),
			env: { ...process.env, PATH: `${bin}:${process.env.PATH}` },
			encoding: "utf8",
		});

		expect(result.status).toBe(23);
		expect(result.stderr).toContain("status 23");
		expect(fs.readFileSync(log, "utf8")).toContain("stop:e2e-obsidian");
		expect(fs.readFileSync(log, "utf8")).not.toContain("test:e2e");
	});

	// Runs run-e2e against a mock pnpm whose start prints this instance's paths
	// and whose Vitest run reports `ran` passed tests.
	function runWithMockVitest(name: string, args: string[], ran: number) {
		const instanceName = `${name}-${process.pid}-${Date.now()}`;
		const initialRoot = prepareProfileRoot();
		const home = path.join(profileRoot, instanceName, "home");
		fs.mkdirSync(home, { recursive: true });
		const vault = path.join(repoRoot, ".obsidian-e2e-vaults", instanceName);
		fs.mkdirSync(vault, { recursive: true });
		const bin = temporaryDirectory("quickadd-mock-bin-args-");
		const log = path.join(bin, "calls.log");
		fs.writeFileSync(path.join(bin, "pnpm"), `#!/usr/bin/env bash
echo "$*" >> ${JSON.stringify(log)}
if [[ "$*" == *"start:e2e-obsidian"* ]]; then
	for prefix in OBSIDIAN QUICKADD; do
		echo "export \${prefix}_E2E_VAULT='${instanceName}'"
		echo "export \${prefix}_E2E_VAULT_PATH='${vault}'"
		echo "export \${prefix}_E2E_OBSIDIAN_HOME='${home}'"
	done
fi
if [[ "$*" == *"test:e2e"* ]]; then
	for arg in "$@"; do
		[[ "$arg" == --outputFile.json=* ]] && echo '{"numPassedTests":${ran},"numFailedTests":0}' > "\${arg#--outputFile.json=}"
	done
fi
exit 0
`, { mode: 0o755 });

		try {
			const result = spawnSync(runE2E, args, {
				env: { ...process.env, PATH: `${bin}:${process.env.PATH}` },
				encoding: "utf8",
			});
			return { result, calls: fs.readFileSync(log, "utf8") };
		} finally {
			fs.rmSync(vault, { recursive: true, force: true });
			cleanProfileInstance(instanceName, initialRoot);
		}
	}

	it("passes its arguments to Vitest as filters", () => {
		const { result, calls } = runWithMockVitest("orb-args-test", ["tests/e2e/field-label.test.ts", "-t", "label"], 1);
		expect(result.status, result.stderr).toBe(0);
		expect(calls).toContain("\nrun test:e2e tests/e2e/field-label.test.ts -t label --reporter=default --reporter=json --outputFile.json=");
	});

	// Vitest exits 0 when a -t filter matches no test.
	it("fails when its arguments match no test", () => {
		const { result, calls } = runWithMockVitest("orb-no-spec-test", ["tests/e2e/field-label.test.ts", "-t", "no such test"], 0);
		expect(result.status).toBe(1);
		expect(result.stderr).toContain("No spec ran");
		expect(calls).toContain("stop:e2e-obsidian");
	});

	it("rejects rather than evaluates unexpected start output", () => {
		const instanceName = `orb-parser-test-${process.pid}-${Date.now()}`;
		const initialRoot = prepareProfileRoot();
		const home = path.join(profileRoot, instanceName, "home");
		fs.mkdirSync(home, { recursive: true });
		const vault = path.join(repoRoot, ".obsidian-e2e-vaults", "quickadd-repo");
		const exports = [
			"export OBSIDIAN_E2E_VAULT='quickadd-repo'",
			`export OBSIDIAN_E2E_VAULT_PATH='${vault}'`,
			`export OBSIDIAN_E2E_OBSIDIAN_HOME='${home}'`,
			"export QUICKADD_E2E_VAULT='quickadd-repo'",
			`export QUICKADD_E2E_VAULT_PATH='${vault}'`,
			`export QUICKADD_E2E_OBSIDIAN_HOME='${home}'`,
		];
		const cases = [
			{ name: "malformed", output: "touch /tmp/quickadd-env-injected\n" },
			{ name: "duplicate", output: `${exports[0]}\n${exports.join("\n")}\n` },
			{ name: "unknown", output: `${exports.join("\n")}\nexport UNEXPECTED='value'\n` },
			{
				name: "canonical/legacy mismatch",
				output: `${exports.join("\n").replace("export QUICKADD_E2E_VAULT='quickadd-repo'", "export QUICKADD_E2E_VAULT='other'")}\n`,
			},
			{ name: "missing variable", output: `${exports.slice(0, -1).join("\n")}\n` },
			{
				name: "missing value",
				output: `${exports.join("\n").replace("export QUICKADD_E2E_VAULT='quickadd-repo'", "export QUICKADD_E2E_VAULT=''")}\n`,
			},
			{
				name: "traversal",
				output: `${exports.join("\n").replace(vault, `${vault}/../quickadd-repo`)}\n`,
			},
			{ name: "CRLF", output: `${exports.join("\r\n")}\r\n` },
		];

		try {
			for (const testCase of cases) {
				const bin = temporaryDirectory(`quickadd-mock-bin-${testCase.name.replaceAll(/[^a-z]/gi, "-")}-`);
				const output = path.join(bin, "start-output");
				const log = path.join(bin, "calls.log");
				fs.writeFileSync(output, testCase.output);
				fs.writeFileSync(
					path.join(bin, "pnpm"),
					`#!/usr/bin/env bash\necho "$*" >> ${JSON.stringify(log)}\nif [[ "$*" == *"start:e2e-obsidian"* ]]; then cat ${JSON.stringify(output)}; fi\n`,
					{ mode: 0o755 },
				);
				const result = spawnSync(runE2E, [], {
					env: { ...process.env, PATH: `${bin}:${process.env.PATH}` },
					encoding: "utf8",
				});
				expect(result.status, testCase.name).toBe(1);
				const calls = fs.readFileSync(log, "utf8");
				expect(calls, testCase.name).toContain("stop:e2e-obsidian");
				expect(calls, testCase.name).not.toContain("test:e2e");
			}
			expect(fs.existsSync("/tmp/quickadd-env-injected")).toBe(false);
		} finally {
			cleanProfileInstance(instanceName, initialRoot);
		}
	});
});
