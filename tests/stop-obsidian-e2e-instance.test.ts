import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
	collectInstancePids,
	commandMatchesInstance,
	isInstanceOrphaned,
	parseArgs,
	parsePsOutput,
	readInstanceVaultPaths,
	reapOrphanedInstances,
	stopInstance,
} from "../scripts/stop-obsidian-e2e-instance.mjs";
import { INSTANCE_MARKER_FILE } from "../scripts/start-obsidian-e2e-instance.mjs";

const tempRoots: string[] = [];

async function makeTempDir(name: string) {
	const dir = await fs.mkdtemp(path.join(os.tmpdir(), `${name}-`));
	tempRoots.push(dir);
	return dir;
}

afterEach(async () => {
	await Promise.all(
		tempRoots
			.splice(0)
			.map((dir) => fs.rm(dir, { recursive: true, force: true })),
	);
});

const INSTANCE = "/tmp/quickadd-obsidian-e2e/quickadd-wt-abc123def456";
const UDD = `--user-data-dir=${INSTANCE}/home/Library/Application Support/obsidian`;

// Mirrors the real `ps -axww -o pid=,ppid=,command=` shape captured from a live
// run: the main process keeps the literal /tmp path we passed, Electron helpers
// canonicalize it to /private/tmp, and unrelated Obsidians (the shared dev vault,
// a sibling worktree, a PodNotes instance) use different user-data-dirs.
const PS_FIXTURE = [
	`  100     1 /Applications/Obsidian.app/Contents/MacOS/Obsidian ${UDD} --password-store=basic`,
	`  101   100 /Applications/Obsidian.app/Contents/Frameworks/Obsidian Helper (GPU).app/Contents/MacOS/Obsidian Helper (GPU) --type=gpu-process --user-data-dir=/private/tmp/quickadd-obsidian-e2e/quickadd-wt-abc123def456/home/Library/Application Support/obsidian`,
	`  102   100 /Applications/Obsidian.app/Contents/Frameworks/Obsidian Helper (Renderer).app/Contents/MacOS/Obsidian Helper (Renderer) --type=renderer --user-data-dir=/private/tmp/quickadd-obsidian-e2e/quickadd-wt-abc123def456/home/Library/Application Support/obsidian`,
	"  103   102 /a/grandchild/process/with/no/token --type=worker",
	"  200     1 /Applications/Obsidian.app/Contents/MacOS/Obsidian",
	"  201   200 /Applications/Obsidian.app/Contents/Frameworks/Obsidian Helper (Renderer).app/Contents/MacOS/Obsidian Helper (Renderer) --type=renderer --user-data-dir=/Users/christian/Library/Application Support/obsidian",
	"  300     1 /Applications/Obsidian.app/Contents/MacOS/Obsidian --user-data-dir=/tmp/podnotes-obsidian-e2e/podnotes-x-000000000000/home/Library/Application Support/obsidian --password-store=basic",
	"  400     1 /Applications/Obsidian.app/Contents/MacOS/Obsidian --user-data-dir=/tmp/quickadd-obsidian-e2e/quickadd-other-111111111111/home/Library/Application Support/obsidian --password-store=basic",
].join("\n");

function makeKillSpy({ alive = false }: { alive?: boolean } = {}) {
	const calls: Array<{ pid: number; signal: string | number }> = [];
	const kill = (pid: number, signal: string | number) => {
		calls.push({ pid, signal });
		// signal 0 is the liveness probe: throw ESRCH to report "dead" unless the
		// test wants the process to survive SIGTERM (to exercise the SIGKILL path).
		if (signal === 0 && !alive) {
			throw Object.assign(new Error("no such process"), { code: "ESRCH" });
		}
	};
	return { calls, kill };
}

describe("stop-obsidian-e2e-instance args", () => {
	it("parses value options and boolean flags", () => {
		const options = parseArgs([
			"--vault",
			"quickadd-a",
			"--profile-root",
			"/tmp/profiles",
			"--prune",
			"--dry-run",
			"--json",
		]);
		expect(options).toMatchObject({
			vault: "quickadd-a",
			profileRoot: "/tmp/profiles",
			prune: true,
			dryRun: true,
			json: true,
		});
	});

	it("rejects unknown options and missing values", () => {
		expect(() => parseArgs(["--nope"])).toThrow(/Unknown option/);
		expect(() => parseArgs(["--vault"])).toThrow(/requires a value/);
	});
});

describe("commandMatchesInstance", () => {
	it("matches both the /tmp and /private/tmp forms of the instance path", () => {
		expect(commandMatchesInstance(`x ${UDD}`, INSTANCE)).toBe(true);
		expect(
			commandMatchesInstance(
				"x --user-data-dir=/private/tmp/quickadd-obsidian-e2e/quickadd-wt-abc123def456/home/x",
				INSTANCE,
			),
		).toBe(true);
	});

	it("does not match the dev vault, PodNotes, or a sibling worktree", () => {
		expect(
			commandMatchesInstance(
				"--user-data-dir=/Users/christian/Library/Application Support/obsidian",
				INSTANCE,
			),
		).toBe(false);
		expect(
			commandMatchesInstance(
				"--user-data-dir=/tmp/podnotes-obsidian-e2e/podnotes-x-000000000000/home/x",
				INSTANCE,
			),
		).toBe(false);
		expect(
			commandMatchesInstance(
				"--user-data-dir=/tmp/quickadd-obsidian-e2e/quickadd-other-111111111111/home/x",
				INSTANCE,
			),
		).toBe(false);
	});

	it("does not match a sibling whose id merely shares this one as a prefix", () => {
		expect(
			commandMatchesInstance(
				`--user-data-dir=${INSTANCE}-extra/home/x`,
				INSTANCE,
			),
		).toBe(false);
	});

	it("does not match a process that mentions the path outside the --user-data-dir flag", () => {
		// e.g. a log tail or editor referencing a file under the instance dir must
		// never be pulled into the kill set.
		expect(
			commandMatchesInstance(`tail -f ${INSTANCE}/home/obsidian.log`, INSTANCE),
		).toBe(false);
	});
});

describe("parsePsOutput / collectInstancePids", () => {
	it("parses pid, ppid and command, skipping non-matching lines", () => {
		const procs = parsePsOutput(`bogus header line\n${PS_FIXTURE}`);
		expect(procs).toContainEqual({
			pid: 100,
			ppid: 1,
			command: expect.stringContaining(UDD),
		});
		expect(procs.find((p) => p.pid === 103)?.ppid).toBe(102);
	});

	it("collects the instance tree (incl. token-less descendants) and nothing else", () => {
		const pids = collectInstancePids(parsePsOutput(PS_FIXTURE), INSTANCE, {
			selfPid: 999999,
		});
		// 100 main + 101/102 helpers (matched by token) + 103 grandchild (matched
		// only by the descendant walk). 200/201 dev vault, 300 PodNotes, 400 sibling
		// worktree are all excluded.
		expect(pids).toEqual([100, 101, 102, 103]);
	});

	it("never includes our own pid", () => {
		const procs = parsePsOutput(`  100     1 x ${UDD} y`);
		expect(collectInstancePids(procs, INSTANCE, { selfPid: 100 })).toEqual([]);
	});
});

describe("stopInstance", () => {
	const runPs = async () => PS_FIXTURE;

	it("SIGTERMs the whole tree and removes the instance dir when it exits", async () => {
		const { calls, kill } = makeKillSpy({ alive: false });
		const removed: string[] = [];
		const result = await stopInstance(INSTANCE, {
			runPs,
			kill,
			removeDir: async (dir: string) => {
				removed.push(dir);
			},
			selfPid: 999999,
			pollMs: 1,
			graceMs: 20,
		});

		const termed = calls
			.filter((c) => c.signal === "SIGTERM")
			.map((c) => c.pid);
		expect(termed).toEqual([100, 101, 102, 103]);
		expect(calls.some((c) => c.signal === "SIGKILL")).toBe(false);
		expect(removed).toEqual([INSTANCE]);
		expect(result).toMatchObject({ killed: [], removed: true });
	});

	it("escalates to SIGKILL for survivors of SIGTERM", async () => {
		const { calls, kill } = makeKillSpy({ alive: true });
		const result = await stopInstance(INSTANCE, {
			runPs,
			kill,
			removeDir: async () => {},
			selfPid: 999999,
			pollMs: 1,
			graceMs: 5,
		});
		const killed = calls
			.filter((c) => c.signal === "SIGKILL")
			.map((c) => c.pid);
		expect(killed).toEqual([100, 101, 102, 103]);
		expect(result.killed).toEqual([100, 101, 102, 103]);
	});

	it("dry-run reports the tree without signalling or removing", async () => {
		const { calls, kill } = makeKillSpy();
		let removeCalled = false;
		const result = await stopInstance(INSTANCE, {
			runPs,
			kill,
			removeDir: async () => {
				removeCalled = true;
			},
			selfPid: 999999,
			dryRun: true,
		});
		expect(calls).toEqual([]);
		expect(removeCalled).toBe(false);
		expect(result).toMatchObject({
			pids: [100, 101, 102, 103],
			removed: false,
		});
	});

	it("refuses to remove a path that is not an instance directory", async () => {
		for (const unsafe of ["/tmp", "relative/path", `${INSTANCE}-no-hash`]) {
			await expect(
				stopInstance(unsafe, {
					runPs,
					kill: () => {},
					removeDir: async () => {},
				}),
			).rejects.toThrow(/Refusing to remove/);
		}
	});

	it("still removes a leftover dir when no process is running", async () => {
		const { calls, kill } = makeKillSpy();
		const removed: string[] = [];
		await stopInstance(INSTANCE, {
			runPs: async () => "",
			kill,
			removeDir: async (dir: string) => {
				removed.push(dir);
			},
			selfPid: 999999,
		});
		expect(calls).toEqual([]);
		expect(removed).toEqual([INSTANCE]);
	});

	it("tolerates EPERM from kill (recycled foreign pid) and still removes the dir", async () => {
		const removed: string[] = [];
		const kill = (_pid: number, signal: string | number) => {
			if (signal === 0) return; // liveness probe: report alive
			throw Object.assign(new Error("operation not permitted"), {
				code: "EPERM",
			});
		};
		const result = await stopInstance(INSTANCE, {
			runPs,
			kill,
			removeDir: async (dir: string) => {
				removed.push(dir);
			},
			selfPid: 999999,
			pollMs: 1,
			graceMs: 5,
		});
		expect(removed).toEqual([INSTANCE]);
		expect(result.removed).toBe(true);
	});

	it("refuses to remove a dir that is not a child of the given profile root", async () => {
		await expect(
			stopInstance(INSTANCE, {
				runPs,
				kill: () => {},
				removeDir: async () => {},
				profileRoot: "/some/other/root",
			}),
		).rejects.toThrow(/not a direct child of profile root/);
	});
});

describe("orphan detection", () => {
	async function seedInstance(
		profileRoot: string,
		id: string,
		vaultPath: string,
	) {
		const udd = path.join(
			profileRoot,
			id,
			"home",
			"Library",
			"Application Support",
			"obsidian",
		);
		await fs.mkdir(udd, { recursive: true });
		await fs.writeFile(
			path.join(udd, "obsidian.json"),
			JSON.stringify({ vaults: { v1: { path: vaultPath, open: true } } }),
		);
		return path.join(profileRoot, id);
	}

	it("reads the registered vault paths", async () => {
		const root = await makeTempDir("quickadd-profiles");
		const instance = await seedInstance(
			root,
			"quickadd-a-aaaaaaaaaaaa",
			"/x/y",
		);
		await expect(readInstanceVaultPaths(instance)).resolves.toEqual(["/x/y"]);
	});

	it("is orphaned only when every backing vault is gone", async () => {
		const root = await makeTempDir("quickadd-profiles");
		const liveVault = await makeTempDir("live-vault");
		const live = await seedInstance(
			root,
			"quickadd-live-bbbbbbbbbbbb",
			liveVault,
		);
		const gone = await seedInstance(
			root,
			"quickadd-gone-cccccccccccc",
			"/does/not/exist",
		);

		await expect(isInstanceOrphaned(live)).resolves.toBe(false);
		await expect(isInstanceOrphaned(gone)).resolves.toBe(true);
	});

	it("prefers the worktree marker: worktree-gone reaps even with a live vault; worktree-alive spares even with a missing vault", async () => {
		const root = await makeTempDir("quickadd-profiles");
		const liveWorktree = await makeTempDir("live-worktree");

		// marker worktree alive, but the vault leaf is gone -> NOT orphaned
		const spared = await seedInstance(
			root,
			"quickadd-m1-aaaaaaaaaaaa",
			"/vault/leaf/gone",
		);
		await fs.writeFile(
			path.join(spared, INSTANCE_MARKER_FILE),
			JSON.stringify({ worktreePath: liveWorktree }),
		);

		// marker worktree gone, but the vault still exists -> orphaned (leaked)
		const leaked = await seedInstance(
			root,
			"quickadd-m2-bbbbbbbbbbbb",
			liveWorktree,
		);
		await fs.writeFile(
			path.join(leaked, INSTANCE_MARKER_FILE),
			JSON.stringify({ worktreePath: "/worktree/removed/on/merge" }),
		);

		await expect(isInstanceOrphaned(spared)).resolves.toBe(false);
		await expect(isInstanceOrphaned(leaked)).resolves.toBe(true);
	});

	it("stays conservative when the registration is unreadable", async () => {
		const root = await makeTempDir("quickadd-profiles");
		const bare = path.join(root, "quickadd-bare-dddddddddddd");
		await fs.mkdir(bare, { recursive: true });
		await expect(isInstanceOrphaned(bare)).resolves.toBe(false);
	});
});

describe("reapOrphanedInstances", () => {
	async function seedInstance(
		profileRoot: string,
		id: string,
		vaultPath: string,
	) {
		const udd = path.join(
			profileRoot,
			id,
			"home",
			"Library",
			"Application Support",
			"obsidian",
		);
		await fs.mkdir(udd, { recursive: true });
		await fs.writeFile(
			path.join(udd, "obsidian.json"),
			JSON.stringify({ vaults: { v1: { path: vaultPath, open: true } } }),
		);
		return path.join(profileRoot, id);
	}

	it("reaps only orphaned instances, skipping live ones, the exception, and non-instance dirs", async () => {
		const root = await makeTempDir("quickadd-profiles");
		const liveVault = await makeTempDir("live-vault");
		const live = await seedInstance(
			root,
			"quickadd-live-bbbbbbbbbbbb",
			liveVault,
		);
		const orphan = await seedInstance(
			root,
			"quickadd-gone-cccccccccccc",
			"/does/not/exist",
		);
		const current = await seedInstance(
			root,
			"quickadd-current-dddddddddddd",
			"/also/gone",
		);
		await fs.mkdir(path.join(root, "not-an-instance"), { recursive: true });

		const removed: string[] = [];
		const result = await reapOrphanedInstances({
			profileRoot: root,
			exceptInstancePath: current,
			runPs: async () => "",
			kill: () => {},
			removeDir: async (dir: string) => {
				removed.push(dir);
			},
		});

		expect(result.reaped).toEqual([orphan]);
		expect(removed).toEqual([orphan]);
		expect(removed).not.toContain(live);
		expect(removed).not.toContain(current);
	});

	it("continues reaping the rest of the scan when one orphan's teardown fails", async () => {
		const root = await makeTempDir("quickadd-profiles");
		const bad = await seedInstance(
			root,
			"quickadd-bad-aaaaaaaaaaaa",
			"/gone/1",
		);
		const good = await seedInstance(
			root,
			"quickadd-good-bbbbbbbbbbbb",
			"/gone/2",
		);
		const removed: string[] = [];
		const logs: string[] = [];

		const result = await reapOrphanedInstances({
			profileRoot: root,
			runPs: async () => "",
			kill: () => {},
			removeDir: async (dir: string) => {
				if (dir === bad) throw new Error("boom");
				removed.push(dir);
			},
			log: (message: string) => logs.push(message),
		});

		expect(removed).toEqual([good]);
		expect(result.reaped).toEqual([good]);
		expect(logs.some((m) => m.includes("Failed to reap"))).toBe(true);
	});

	it("returns an empty result when the profile root does not exist", async () => {
		await expect(
			reapOrphanedInstances({ profileRoot: "/no/such/profile/root" }),
		).resolves.toEqual({ scanned: 0, reaped: [] });
	});
});
