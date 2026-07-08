import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
	assertObsidianMeetsMinAppVersion,
	assertSecureDirIfPresent,
	compareObsidianVersions,
	ensureSecureDir,
	INSTANCE_MARKER_FILE,
	parseArgs,
	prepareObsidianProfile,
	readInstanceMarker,
	resolveInstanceOptions,
	resolveObsidianAppVersion,
	stampInstanceMarkerAppVersion,
	toInstanceShellExports,
} from "../scripts/start-obsidian-e2e-instance.mjs";

const tempRoots: string[] = [];

async function makeTempDir(name: string) {
	const dir = await fs.mkdtemp(path.join(os.tmpdir(), `${name}-`));
	tempRoots.push(dir);
	return dir;
}

afterEach(async () => {
	await Promise.all(
		tempRoots.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })),
	);
});

describe("start-obsidian-e2e-instance", () => {
	it("creates a private Obsidian profile registered to the provisioned vault", async () => {
		const cwd = await makeTempDir("quickadd-instance");
		const options = resolveInstanceOptions(
			parseArgs([
				"--vault",
				"quickadd-worktree-a",
				"--root",
				"vaults",
				"--profile-root",
				"profiles",
				"--no-launch",
			]),
			cwd,
		);

		const profile = await prepareObsidianProfile({
			...options,
			// Hermetic: never scan the real host config dir / copy a real asar.
			obsidianConfigDir: await makeTempDir("quickadd-empty-config"),
			bundledAsarCandidates: [] as string[],
		});
		const registry = JSON.parse(await fs.readFile(profile.obsidianJsonPath, "utf8"));
		const vaults = Object.values(registry.vaults) as Array<{ path: string; open: boolean }>;

		expect(registry.cli).toBe(true);
		expect(registry.updateDisabled).toBe(true);
		const hostKeychains = path.join(process.env.HOME ?? "", "Library", "Keychains");
		const privateKeychains = path.join(options.obsidianHome, "Library", "Keychains");
		if (await exists(hostKeychains)) {
			await expect(fs.readlink(privateKeychains)).resolves.toBe(hostKeychains);
		} else {
			await expect(fs.lstat(privateKeychains)).rejects.toMatchObject({ code: "ENOENT" });
		}
		expect(options.obsidianHome.startsWith(path.join(cwd, "profiles", "quickadd-worktree-a-"))).toBe(true);
		expect(options.obsidianHome.endsWith("/home")).toBe(true);
		expect(vaults).toEqual([
			{
				open: true,
				path: path.join(cwd, "vaults", "quickadd-worktree-a"),
				ts: expect.any(Number),
			},
		]);
		expect(toInstanceShellExports({
			obsidianHome: options.obsidianHome,
			vaultName: options.vaultName,
			vaultPath: options.vaultPath,
		})).toContain("QUICKADD_E2E_OBSIDIAN_HOME=");
	});

	it("writes the worktree marker the teardown reaper consumes", async () => {
		const cwd = await makeTempDir("quickadd-instance");
		const options = resolveInstanceOptions(
			parseArgs([
				"--vault",
				"quickadd-worktree-b",
				"--root",
				"vaults",
				"--profile-root",
				"profiles",
				"--no-launch",
			]),
			cwd,
		);
		// Hermetic app-version resolution: no real host config dir, no bundled
		// installer — so the test never copies a real ~25MB asar and the marker's
		// appVersion is deterministically null.
		const hermetic = {
			...options,
			obsidianConfigDir: await makeTempDir("quickadd-empty-config"),
			bundledAsarCandidates: [] as string[],
		};

		await prepareObsidianProfile(hermetic);

		// The reaper keys off this exact sidecar (see isInstanceOrphaned). Prove the
		// producer (prepareObsidianProfile, shared by start + the CLI wrapper) writes
		// it at the instance root with the worktree path the reaper checks for.
		const marker = JSON.parse(
			await fs.readFile(
				path.join(options.instancePath, INSTANCE_MARKER_FILE),
				"utf8",
			),
		);
		expect(marker).toEqual({
			worktreePath: options.worktreePath,
			vaultName: options.vaultName,
			vaultPath: options.vaultPath,
			appVersion: null,
		});
		expect(path.resolve(marker.worktreePath)).toBe(path.resolve(cwd));
	});
});

describe("ensureSecureDir", () => {
	it("creates a fresh profile dir owned by us with 0o700", async () => {
		const root = await makeTempDir("quickadd-secure");
		const dir = path.join(root, "profile-root");

		await ensureSecureDir(dir);

		const stat = await fs.lstat(dir);
		expect(stat.isDirectory()).toBe(true);
		expect(stat.mode & 0o777).toBe(0o700);
		if (typeof process.getuid === "function") {
			expect(stat.uid).toBe(process.getuid());
		}
	});

	it("rejects a pre-existing group/world-accessible dir (planted-child race)", async () => {
		const root = await makeTempDir("quickadd-secure");
		const dir = path.join(root, "loose");
		await fs.mkdir(dir, { recursive: true });
		await fs.chmod(dir, 0o777);

		// A loose dir may already hold a foreign-planted child symlink that a parent
		// chmod would not undo, so we refuse it outright rather than "repair" it.
		await expect(ensureSecureDir(dir)).rejects.toThrow(/group\/other-accessible/);
	});

	it("refuses a symlink at the profile path (never follows it)", async () => {
		const root = await makeTempDir("quickadd-secure");
		const target = path.join(root, "attacker-owned");
		await fs.mkdir(target, { recursive: true });
		const link = path.join(root, "profile-root");
		await fs.symlink(target, link);

		await expect(ensureSecureDir(link)).rejects.toThrow(/symlink or not a regular directory/);
		// The symlink target must be untouched - we must not have written through it.
		expect((await fs.readdir(target)).length).toBe(0);
	});

	it("refuses a dir owned by a different uid (temp-squat)", async () => {
		const root = await makeTempDir("quickadd-secure");
		const dir = path.join(root, "foreign");
		await fs.mkdir(dir, { recursive: true, mode: 0o700 });

		const foreignUid = (process.getuid?.() ?? 0) + 4242;
		await expect(
			ensureSecureDir(dir, { currentUid: foreignUid }),
		).rejects.toThrow(/owned by uid/);
	});

	it("skips the owner check when getuid is unavailable (currentUid null)", async () => {
		const root = await makeTempDir("quickadd-secure");
		const dir = path.join(root, "no-getuid");
		await fs.mkdir(dir, { recursive: true, mode: 0o700 });

		// Platforms without process.getuid resolve currentUid to null; the owner
		// check is then skipped rather than throwing against an undefined uid.
		await expect(ensureSecureDir(dir, { currentUid: null })).resolves.toBe(dir);
	});
});

describe("assertSecureDirIfPresent", () => {
	it("returns false for an absent dir without creating it", async () => {
		const root = await makeTempDir("quickadd-secure");
		const dir = path.join(root, "missing");

		await expect(assertSecureDirIfPresent(dir)).resolves.toBe(false);
		// Teardown must not create the root it is asked to clean up.
		await expect(fs.lstat(dir)).rejects.toMatchObject({ code: "ENOENT" });
	});

	it("accepts an existing private dir we own", async () => {
		const root = await makeTempDir("quickadd-secure");
		const dir = path.join(root, "ours");
		await fs.mkdir(dir, { recursive: true, mode: 0o700 });

		await expect(assertSecureDirIfPresent(dir)).resolves.toBe(true);
	});

	it("refuses a symlinked profile root (teardown must not traverse it)", async () => {
		const root = await makeTempDir("quickadd-secure");
		const target = path.join(root, "attacker-owned");
		await fs.mkdir(target, { recursive: true });
		const link = path.join(root, "profile-root");
		await fs.symlink(target, link);

		await expect(assertSecureDirIfPresent(link)).rejects.toThrow(
			/symlink or not a regular directory/,
		);
	});
});

function u32(n: number): Buffer {
	const b = Buffer.alloc(4);
	b.writeUInt32LE(n, 0);
	return b;
}

// Build a spec-correct asar (matching the real Pickle layout: [size pickle][header
// pickle][file data], with the header JSON 4-byte aligned inside the header
// pickle). `extraJsonPad` widens the header JSON by EXACTLY that many bytes (the
// `_pad` key is always present, so each +1 shifts the length to the next 4-byte
// residue) — exercising the alignment padding that a naive `16 + jsonLength`
// reader gets wrong.
function buildAsar(version: string, extraJsonPad = 0): Buffer {
	const pkg = Buffer.from(JSON.stringify({ version }), "utf8");
	const files: Record<string, unknown> = {
		"package.json": { offset: "0", size: pkg.length },
		_pad: "x".repeat(extraJsonPad),
	};
	const json = Buffer.from(JSON.stringify({ files }), "utf8");
	const aligned = Buffer.concat([json, Buffer.alloc((4 - (json.length % 4)) % 4)]);
	const headerPayload = Buffer.concat([u32(json.length), aligned]);
	const headerPickle = Buffer.concat([u32(headerPayload.length), headerPayload]);
	const sizePickle = Buffer.concat([u32(4), u32(headerPickle.length)]);
	return Buffer.concat([sizePickle, headerPickle, pkg]);
}

async function makeConfigDir(versions: string[]): Promise<string> {
	const dir = await makeTempDir("obsidian-config");
	// Real asars (carrying their own package.json version), so the resolver reads
	// the same code path it does against a live config dir, not a filename shortcut.
	await Promise.all(
		versions.map((v) => fs.writeFile(path.join(dir, `obsidian-${v}.asar`), buildAsar(v))),
	);
	return dir;
}

async function makeWorktreeWithManifest(minAppVersion: string): Promise<string> {
	const dir = await makeTempDir("quickadd-worktree");
	await fs.writeFile(
		path.join(dir, "manifest.json"),
		JSON.stringify({ id: "quickadd", minAppVersion }),
	);
	return dir;
}

describe("compareObsidianVersions", () => {
	it("orders by major, minor, then patch and ignores suffixes", () => {
		expect(compareObsidianVersions("1.13.0", "1.13.0")).toBe(0);
		expect(compareObsidianVersions("1.13.1", "1.13.0")).toBeGreaterThan(0);
		expect(compareObsidianVersions("1.12.7", "1.13.0")).toBeLessThan(0);
		expect(compareObsidianVersions("1.13.0-insider", "1.13.0")).toBe(0);
		expect(compareObsidianVersions("2.0.0", "1.99.99")).toBeGreaterThan(0);
	});
});

describe("resolveObsidianAppVersion", () => {
	it("picks the newest installed asar in the config dir", async () => {
		const configDir = await makeConfigDir(["1.12.7", "1.13.0"]);
		const resolved = await resolveObsidianAppVersion({
			obsidianConfigDir: configDir,
			bundledAsarCandidates: [],
		});
		expect(resolved.appVersion).toBe("1.13.0");
		expect(resolved.cachedVersions.sort()).toEqual(["1.12.7", "1.13.0"]);
		// The seeding step copies exactly this file (single resolver authority).
		expect(resolved.newestCachedAsar).toEqual({
			name: "obsidian-1.13.0.asar",
			path: path.join(configDir, "obsidian-1.13.0.asar"),
			version: "1.13.0",
		});
	});

	it("seeds the resolved asar into the sandbox profile and records it in the marker", async () => {
		// The launched instance resolves its app-code asar from the ISOLATED
		// sandbox home; prepareObsidianProfile must therefore materialize the
		// version the guard predicts (and reconcile away stale sandbox asars, so
		// a leftover newer file can't outrank the prediction).
		const cwd = await makeTempDir("quickadd-instance");
		const options = resolveInstanceOptions(
			parseArgs([
				"--vault",
				"quickadd-worktree-seed",
				"--root",
				"vaults",
				"--profile-root",
				"profiles",
				"--no-launch",
			]),
			cwd,
		);

		const first = await prepareObsidianProfile({
			...options,
			obsidianConfigDir: await makeConfigDir(["1.12.7"]),
			bundledAsarCandidates: [] as string[],
		});
		await expect(
			fs.stat(path.join(first.userDataPath, "obsidian-1.12.7.asar")),
		).resolves.toBeTruthy();
		expect(first.appVersion).toBe("1.12.7");

		// The marker's appVersion records LAUNCH time, not prediction time — a
		// profile that was prepared but never launched stays unstamped.
		expect(
			(await readInstanceMarker(options.instancePath))?.appVersion,
		).toBeNull();

		// Launch happened on 1.12.7: the launch path stamps the marker.
		await stampInstanceMarkerAppVersion(options.instancePath, "1.12.7");
		expect(
			(await readInstanceMarker(options.instancePath))?.appVersion,
		).toBe("1.12.7");

		// Host updated: re-preparing swaps the sandbox to the new resolution and
		// removes the now-stale asar — but must PRESERVE the launch-time marker
		// (overwriting it with the new prediction would blind the CLI's reuse
		// guard on its second run, while the old instance is still running).
		const second = await prepareObsidianProfile({
			...options,
			obsidianConfigDir: await makeConfigDir(["1.13.0"]),
			bundledAsarCandidates: [] as string[],
		});
		await expect(
			fs.stat(path.join(second.userDataPath, "obsidian-1.13.0.asar")),
		).resolves.toBeTruthy();
		await expect(
			fs.stat(path.join(second.userDataPath, "obsidian-1.12.7.asar")),
		).rejects.toMatchObject({ code: "ENOENT" });
		expect(second.appVersion).toBe("1.13.0");
		expect(
			(await readInstanceMarker(options.instancePath))?.appVersion,
		).toBe("1.12.7");
	});

	it("floors at the bundled installer asar when the config dir is empty", async () => {
		const configDir = await makeConfigDir([]);
		const bundled = path.join(await makeTempDir("obsidian-app"), "obsidian.asar");
		await fs.writeFile(bundled, buildAsar("1.12.7"));
		const resolved = await resolveObsidianAppVersion({
			obsidianConfigDir: configDir,
			bundledAsarCandidates: [bundled],
		});
		expect(resolved.appVersion).toBe("1.12.7");
		expect(resolved.installerVersion).toBe("1.12.7");
	});

	it("returns null appVersion when nothing can be determined", async () => {
		const configDir = await makeConfigDir([]);
		const resolved = await resolveObsidianAppVersion({
			obsidianConfigDir: configDir,
			bundledAsarCandidates: [path.join(configDir, "does-not-exist.asar")],
		});
		expect(resolved.appVersion).toBeNull();
	});

	it("skips a partial/corrupt cached asar instead of trusting its filename", async () => {
		// A half-downloaded obsidian-1.13.0.asar (truncated/garbage) must NOT count as
		// a runnable 1.13.0 — Obsidian would fall back to the valid 1.12.7 build.
		const configDir = await makeConfigDir(["1.12.7"]);
		await fs.writeFile(path.join(configDir, "obsidian-1.13.0.asar"), "not-a-real-asar");
		const resolved = await resolveObsidianAppVersion({
			obsidianConfigDir: configDir,
			bundledAsarCandidates: [],
		});
		expect(resolved.appVersion).toBe("1.12.7");
		expect(resolved.cachedVersions).toEqual(["1.12.7"]);
	});

	it("reads the asar version at every header-length 4-byte alignment residue", async () => {
		// Real asar headers are arbitrary lengths; the parser must not assume the
		// header JSON is 4-byte aligned. Cover all four residues — a reader that uses
		// `16 + jsonLength` instead of the header pickle size misreads 3 of these.
		const residues = new Set<number>();
		for (let pad = 0; pad < 4; pad++) {
			const asar = buildAsar("1.13.0", pad);
			// Header JSON length lives at byte 12 (raw, pre-alignment) in the layout.
			residues.add(asar.readUInt32LE(12) % 4);
			const dir = await makeTempDir("asar-align");
			await fs.writeFile(path.join(dir, "obsidian-1.13.0.asar"), asar);
			const resolved = await resolveObsidianAppVersion({
				obsidianConfigDir: dir,
				bundledAsarCandidates: [],
			});
			expect(resolved.appVersion, `pad=${pad}`).toBe("1.13.0");
		}
		// Guard the guard: prove the four builds really span all four residues, so a
		// future tweak can't silently collapse coverage (as an earlier version did).
		expect(residues).toEqual(new Set([0, 1, 2, 3]));
	});
});

describe("assertObsidianMeetsMinAppVersion", () => {
	it("passes when the running app meets minAppVersion (green)", async () => {
		const worktreePath = await makeWorktreeWithManifest("1.13.0");
		const configDir = await makeConfigDir(["1.12.7", "1.13.0"]);
		await expect(
			assertObsidianMeetsMinAppVersion({
				worktreePath,
				obsidianConfigDir: configDir,
				bundledAsarCandidates: [],
			}),
		).resolves.toEqual({
			appVersion: "1.13.0",
			installerVersion: null,
			minAppVersion: "1.13.0",
		});
	});

	it("fails loudly when Obsidian fell back below minAppVersion (red)", async () => {
		const worktreePath = await makeWorktreeWithManifest("1.13.0");
		// Only a sub-minimum 1.12.7 build installed — the exact fallback that made
		// setDestructive look "absent on 1.13.0".
		const configDir = await makeConfigDir(["1.12.7"]);
		await expect(
			assertObsidianMeetsMinAppVersion({
				worktreePath,
				obsidianConfigDir: configDir,
				bundledAsarCandidates: [],
			}),
		).rejects.toThrow(/1\.12\.7 is BELOW the plugin's minAppVersion 1\.13\.0/);
	});

	it("refuses to run when the app version cannot be determined", async () => {
		const worktreePath = await makeWorktreeWithManifest("1.13.0");
		const configDir = await makeConfigDir([]);
		await expect(
			assertObsidianMeetsMinAppVersion({
				worktreePath,
				obsidianConfigDir: configDir,
				bundledAsarCandidates: [],
			}),
		).rejects.toThrow(/Could not determine the running Obsidian app version/);
	});
});

async function exists(filePath: string) {
	try {
		await fs.lstat(filePath);
		return true;
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
		throw error;
	}
}
