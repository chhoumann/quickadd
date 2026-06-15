import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
	parseArgs,
	provisionVault,
	resolveProvisionOptions,
	toShellExports,
} from "../scripts/provision-obsidian-e2e-vault.mjs";

const tempRoots: string[] = [];

async function makeTempDir(name: string) {
	const dir = await fs.mkdtemp(path.join(os.tmpdir(), `${name}-`));
	tempRoots.push(dir);
	return dir;
}

async function seedWorktree(dir: string, label: string) {
	await fs.mkdir(dir, { recursive: true });
	await fs.writeFile(path.join(dir, "manifest.json"), JSON.stringify({ id: "quickadd" }));
	await fs.writeFile(path.join(dir, "main.js"), `console.log(${JSON.stringify(label)});\n`);
	await fs.writeFile(path.join(dir, "styles.css"), `.quickadd-${label} {}\n`);
}

async function readLinkedTarget(filePath: string) {
	return path.resolve(path.dirname(filePath), await fs.readlink(filePath));
}

afterEach(async () => {
	await Promise.all(
		tempRoots.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })),
	);
});

describe("provision-obsidian-e2e-vault", () => {
	it("parses registration options", () => {
		const options = resolveProvisionOptions(
			parseArgs(["--vault", "quickadd-a", "--register-via", "dev"]),
			"/tmp/quickadd-repo",
		);

		expect(options.registerVia).toBe("dev");
		expect(options.vaultName).toBe("quickadd-a");
		expect(options.vaultPath).toBe("/tmp/quickadd-repo/.obsidian-e2e-vaults/quickadd-a");
	});

	it("creates an Obsidian vault with QuickAdd symlinked from a worktree", async () => {
		const root = await makeTempDir("quickadd-e2e-root");
		const worktree = await makeTempDir("quickadd-worktree-a");
		await seedWorktree(worktree, "a");

		const options = resolveProvisionOptions({
			root,
			vault: "quickadd-a",
			worktree,
		});

		const result = await provisionVault(options);
		const pluginPath = path.join(result.vaultPath, ".obsidian", "plugins", "quickadd");

		await expect(fs.readFile(path.join(result.vaultPath, ".obsidian", "community-plugins.json"), "utf8"))
			.resolves.toBe("[\n\t\"quickadd\"\n]\n");
		await expect(readLinkedTarget(path.join(pluginPath, "main.js")))
			.resolves.toBe(path.join(worktree, "main.js"));
		await expect(readLinkedTarget(path.join(pluginPath, "manifest.json")))
			.resolves.toBe(path.join(worktree, "manifest.json"));
		await expect(readLinkedTarget(path.join(pluginPath, "styles.css")))
			.resolves.toBe(path.join(worktree, "styles.css"));
		await expect(fs.readFile(path.join(pluginPath, "data.json"), "utf8"))
			.resolves.toBe("{\n\t\"choices\": [],\n\t\"migrations\": {}\n}\n");
		expect(result.registered).toBe(false);
		expect(result.trusted).toBe(false);
		expect(result.verifiedQuickAdd).toBe(false);
		expect(toShellExports(result)).toContain("QUICKADD_E2E_VAULT='quickadd-a'");
		expect(toShellExports(result)).toContain(`QUICKADD_E2E_VAULT_PATH='${result.vaultPath}'`);
	});

	it("keeps separately provisioned worktrees isolated", async () => {
		const root = await makeTempDir("quickadd-e2e-root");
		const worktreeA = await makeTempDir("quickadd-worktree-a");
		const worktreeB = await makeTempDir("quickadd-worktree-b");
		await seedWorktree(worktreeA, "a");
		await seedWorktree(worktreeB, "b");

		const resultA = await provisionVault(resolveProvisionOptions({
			root,
			vault: "quickadd-a",
			worktree: worktreeA,
		}));
		const resultB = await provisionVault(resolveProvisionOptions({
			root,
			vault: "quickadd-b",
			worktree: worktreeB,
		}));

		const mainA = path.join(resultA.vaultPath, ".obsidian", "plugins", "quickadd", "main.js");
		const mainB = path.join(resultB.vaultPath, ".obsidian", "plugins", "quickadd", "main.js");

		await expect(readLinkedTarget(mainA)).resolves.toBe(path.join(worktreeA, "main.js"));
		await expect(readLinkedTarget(mainB)).resolves.toBe(path.join(worktreeB, "main.js"));
		expect(resultA.vaultPath).not.toBe(resultB.vaultPath);
	});

	it("does not overwrite existing plugin data", async () => {
		const root = await makeTempDir("quickadd-e2e-root");
		const worktree = await makeTempDir("quickadd-worktree");
		const seedData = path.join(await makeTempDir("quickadd-seed"), "data.json");
		await seedWorktree(worktree, "a");
		await fs.writeFile(seedData, "{\"choices\":[{\"name\":\"seed\"}]}\n");

		const options = resolveProvisionOptions({
			data: seedData,
			root,
			vault: "quickadd-data",
			worktree,
		});

		const result = await provisionVault(options);
		const dataPath = path.join(result.pluginPath, "data.json");
		await fs.writeFile(dataPath, "{\"choices\":[{\"name\":\"kept\"}]}\n");
		await provisionVault(options);

		await expect(fs.readFile(dataPath, "utf8"))
			.resolves.toBe("{\"choices\":[{\"name\":\"kept\"}]}\n");
	});
});
