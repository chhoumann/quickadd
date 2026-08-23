import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

const repoRoot = path.resolve(import.meta.dirname, "..");
const runE2E = path.join(repoRoot, ".agents", "run-e2e");
const openShim = path.join(repoRoot, ".agents", "obsidian-open");
const patcher = path.join(repoRoot, ".agents", "patch-obsidian-e2e-linux.mjs");
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
		expect(fs.readFileSync(log, "utf8")).not.toContain("test:e2e --");
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
				expect(calls, testCase.name).not.toContain("test:e2e --");
			}
			expect(fs.existsSync("/tmp/quickadd-env-injected")).toBe(false);
		} finally {
			cleanProfileInstance(instanceName, initialRoot);
		}
	});
});

describe.skipIf(!runningOnLinux)("Linux Obsidian launcher validation", () => {
	function validArgs(validHome: string): string[] {
		return [
		"-n",
		"-g",
		"-a",
		"Obsidian",
		"--env",
		`HOME=${validHome}`,
		"--args",
		`--user-data-dir=${validHome}/Library/Application Support/obsidian`,
		"--password-store=basic",
		];
	}

	function validate(args: string[]): ReturnType<typeof spawnSync> {
		return spawnSync(openShim, args, {
			env: { ...process.env, QUICKADD_OBSIDIAN_OPEN_VALIDATE_ONLY: "1" },
			encoding: "utf8",
		});
	}

	it("preserves a pre-existing runner-owned profile root", () => {
		const testCreatedRoot = !fs.existsSync(profileRoot);
		if (testCreatedRoot) {
			fs.mkdirSync(profileRoot, { mode: 0o700 });
			fs.chmodSync(profileRoot, 0o700);
		}
		const before = profileRootState(false);
		const instanceName = `orb-root-preservation-${process.pid}-${Date.now()}`;
		fs.mkdirSync(path.join(profileRoot, instanceName, "home"), { recursive: true });

		try {
			cleanProfileInstance(instanceName, before);
			expect(profileRootState(false)).toEqual(before);
		} finally {
			fs.rmSync(path.join(profileRoot, instanceName), { recursive: true, force: true });
			if (testCreatedRoot) {
				const finalState = profileRootState(false);
				expect(finalState).toEqual(before);
				expect(finalState.entries).toEqual([]);
				expect(finalState.mode).toBe(0o700);
				fs.rmdirSync(profileRoot);
				expect(fs.existsSync(profileRoot)).toBe(false);
			}
		}
	});

	it("accepts only the runner's exact canonical argv", () => {
		const instanceName = `orb-script-test-${process.pid}-${Date.now()}`;
		const initialRoot = prepareProfileRoot();
		const validHome = path.join(profileRoot, instanceName, "home");
		const args = validArgs(validHome);
		const escapedHome = temporaryDirectory("quickadd-obsidian-escaped-home-");
		const linkName = `orb-script-link-${process.pid}-${Date.now()}`;
		const linkPath = path.join(profileRoot, linkName);
		fs.mkdirSync(validHome, { recursive: true });
		fs.writeFileSync(path.join(validHome, "..", "obsidian-e2e-instance.json"), "{}");
		try {
			expect(validate(args).status).toBe(0);
			const adversarial = [
				args.slice(1),
				args.filter((argument) => argument !== "-g"),
				args.filter((_, index) => index !== 4 && index !== 5),
				[args[1], args[0], ...args.slice(2)],
				[...args, "--extra"],
				args.filter((argument) => argument !== "--password-store=basic"),
				[...args.slice(0, 7), args[8], args[7]],
				args.map((argument) =>
					argument === `HOME=${validHome}` ? `HOME=${validHome}/../home` : argument,
				),
			];
			fs.symlinkSync(escapedHome, linkPath);
			adversarial.push(
				args.map((argument) =>
					argument.includes(validHome)
						? argument.replace(validHome, linkPath)
						: argument,
				),
			);
			for (const args of adversarial) expect(validate(args).status).not.toBe(0);
		} finally {
			fs.rmSync(linkPath, { force: true });
			cleanProfileInstance(instanceName, initialRoot);
		}
	});
});

describe("obsidian-e2e Linux patcher", () => {
	const originalLaunch = 'resolveExec(deps)("/usr/bin/open", [';
	const originalAsar =
		'return [path.join("/Applications", leaf), path.join(os.userInfo().homedir, "Applications", leaf)];';

	it("rejects duplicate targets without modifying the bundle", () => {
		const dist = temporaryDirectory("quickadd-patcher-");
		const bundle = path.join(dist, "runner.mjs");
		const source = `${originalLaunch}\n${originalLaunch}\n${originalAsar}\n`;
		fs.writeFileSync(bundle, source);
		const result = spawnSync(process.execPath, [patcher, "--dist-dir", dist], { encoding: "utf8" });
		expect(result.status).not.toBe(0);
		expect(fs.readFileSync(bundle, "utf8")).toBe(source);
		expect(fs.readdirSync(dist)).toEqual(["runner.mjs"]);
	});

	it("atomically patches and then validates one expected bundle", () => {
		const dist = temporaryDirectory("quickadd-patcher-");
		const bundle = path.join(dist, "runner.mjs");
		fs.writeFileSync(bundle, `${originalLaunch}\n${originalAsar}\n`);
		execFileSync(process.execPath, [patcher, "--dist-dir", dist]);
		execFileSync(process.execPath, [patcher, "--check", "--dist-dir", dist]);
		const patchedBundle = fs.readFileSync(bundle, "utf8");
		expect(patchedBundle).toMatch(/\.agents[\\/]+obsidian-open/);
		expect(patchedBundle).toContain("/opt/Obsidian/resources/obsidian.asar");
		expect(fs.readdirSync(dist)).toEqual(["runner.mjs"]);
	});
});
