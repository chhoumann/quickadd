import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
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

async function exists(filePath: string) {
	try {
		await fs.lstat(filePath);
		return true;
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
		throw error;
	}
}
