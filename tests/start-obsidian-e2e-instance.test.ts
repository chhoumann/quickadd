import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
	assertSecureDirIfPresent,
	ensureSecureDir,
	INSTANCE_MARKER_FILE,
	parseArgs,
	prepareObsidianProfile,
	resolveInstanceOptions,
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

		const profile = await prepareObsidianProfile(options);
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

		await prepareObsidianProfile(options);

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

async function exists(filePath: string) {
	try {
		await fs.lstat(filePath);
		return true;
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
		throw error;
	}
}
