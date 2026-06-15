#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const REQUIRED_PLUGIN_FILES = ["manifest.json", "main.js", "styles.css"];
const DEFAULT_ROOT = ".obsidian-e2e-vaults";
const DEFAULT_VAULT_PREFIX = "quickadd";
const DEFAULT_QUICKADD_DATA = { choices: [], migrations: {} };
const execFileAsync = promisify(execFile);
const QUICKADD_VERIFY_TIMEOUT_MS = 15_000;
const QUICKADD_VERIFY_INTERVAL_MS = 500;

function slugify(value) {
	return value
		.toLowerCase()
		.replace(/[^a-z0-9._-]+/g, "-")
		.replace(/^-+|-+$/g, "")
		.slice(0, 80) || "worktree";
}

function printUsage() {
	console.log(`Usage: node scripts/provision-obsidian-e2e-vault.mjs [options]

Options:
  --vault <name>        Vault name to provision. Defaults to quickadd-<worktree>.
  --root <path>         Directory that contains provisioned vaults. Defaults to .obsidian-e2e-vaults.
  --worktree <path>     QuickAdd worktree to link plugin files from. Defaults to cwd.
  --data <path>         Optional QuickAdd data.json seed to copy on first provision.
  --register-via <name> Register the provisioned vault through an open CLI-addressable vault.
  --force               Recreate plugin symlinks if they already exist.
  --print-env           Print QUICKADD_E2E_VAULT exports after provisioning.
  --json                Print a machine-readable summary after provisioning.
  --help                Show this help.
`);
}

export function parseArgs(argv) {
	const options = {
		force: false,
		json: false,
		printEnv: false,
	};

	for (let index = 0; index < argv.length; index += 1) {
		const arg = argv[index];
		switch (arg) {
			case "--":
				break;
			case "--force":
				options.force = true;
				break;
			case "--json":
				options.json = true;
				break;
			case "--print-env":
				options.printEnv = true;
				break;
			case "--help":
				options.help = true;
				break;
			case "--vault":
			case "--root":
			case "--worktree":
			case "--data":
			case "--register-via": {
				const value = argv[index + 1];
				if (!value || value.startsWith("--")) {
					throw new Error(`${arg} requires a value.`);
				}
				options[toOptionKey(arg)] = value;
				index += 1;
				break;
			}
			default:
				throw new Error(`Unknown option: ${arg}`);
		}
	}

	return options;
}

function toOptionKey(arg) {
	if (arg === "--register-via") return "registerVia";
	return arg.slice(2);
}

export function resolveProvisionOptions(rawOptions, cwd = process.cwd()) {
	const worktreePath = path.resolve(cwd, rawOptions.worktree ?? ".");
	const vaultName = rawOptions.vault ?? `${DEFAULT_VAULT_PREFIX}-${slugify(path.basename(worktreePath))}`;
	const rootPath = path.resolve(cwd, rawOptions.root ?? DEFAULT_ROOT);
	const vaultPath = path.resolve(rootPath, vaultName);
	const dataPath = rawOptions.data
		? path.resolve(cwd, rawOptions.data)
		: undefined;

	return {
		dataPath,
		force: rawOptions.force ?? false,
		json: rawOptions.json ?? false,
		printEnv: rawOptions.printEnv ?? false,
		registerVia: rawOptions.registerVia,
		rootPath,
		vaultName,
		vaultPath,
		worktreePath,
	};
}

async function pathExists(filePath) {
	try {
		await fs.lstat(filePath);
		return true;
	} catch (error) {
		if (error?.code === "ENOENT") return false;
		throw error;
	}
}

async function assertRequiredPluginFiles(worktreePath) {
	const missing = [];
	for (const fileName of REQUIRED_PLUGIN_FILES) {
		const filePath = path.join(worktreePath, fileName);
		if (!(await pathExists(filePath))) missing.push(fileName);
	}

	if (missing.length > 0) {
		throw new Error(
			[
				`Cannot provision QuickAdd in ${worktreePath}; missing ${missing.join(", ")}.`,
				"Run pnpm run build in that worktree before provisioning.",
			].join(" "),
		);
	}
}

async function writeJson(filePath, value) {
	await fs.mkdir(path.dirname(filePath), { recursive: true });
	await fs.writeFile(`${filePath}.tmp`, `${JSON.stringify(value, null, "\t")}\n`);
	await fs.rename(`${filePath}.tmp`, filePath);
}

async function writeJsonIfMissing(filePath, value) {
	if (await pathExists(filePath)) return;
	await writeJson(filePath, value);
}

async function linkPluginFile(sourcePath, destinationPath, force) {
	const existing = await pathExists(destinationPath);
	if (existing && force) {
		await fs.unlink(destinationPath);
	} else if (existing) {
		const stat = await fs.lstat(destinationPath);
		if (!stat.isSymbolicLink()) {
			throw new Error(`${destinationPath} exists and is not a symlink. Use --force after reviewing it.`);
		}

		const currentTarget = await fs.readlink(destinationPath);
		if (path.resolve(path.dirname(destinationPath), currentTarget) === sourcePath) {
			return;
		}

		throw new Error(`${destinationPath} points at ${currentTarget}. Use --force to relink it.`);
	}

	await fs.symlink(sourcePath, destinationPath);
}

export async function provisionVault(options) {
	await assertRequiredPluginFiles(options.worktreePath);

	const obsidianPath = path.join(options.vaultPath, ".obsidian");
	const pluginPath = path.join(obsidianPath, "plugins", "quickadd");

	await fs.mkdir(pluginPath, { recursive: true });
	await writeJsonIfMissing(path.join(obsidianPath, "app.json"), {});
	await writeJsonIfMissing(path.join(obsidianPath, "appearance.json"), {});
	await writeJsonIfMissing(path.join(obsidianPath, "core-plugins.json"), []);
	await writeJson(path.join(obsidianPath, "community-plugins.json"), ["quickadd"]);
	await writeJsonIfMissing(path.join(obsidianPath, "workspace.json"), {
		main: { id: "quickadd-e2e", type: "split", children: [] },
		left: { id: "quickadd-e2e-left", type: "split", children: [] },
		right: { id: "quickadd-e2e-right", type: "split", children: [] },
	});

	for (const fileName of REQUIRED_PLUGIN_FILES) {
		await linkPluginFile(
			path.join(options.worktreePath, fileName),
			path.join(pluginPath, fileName),
			options.force,
		);
	}

	const pluginDataPath = path.join(pluginPath, "data.json");
	if (options.dataPath && !(await pathExists(pluginDataPath))) {
		await fs.copyFile(options.dataPath, pluginDataPath);
	} else {
		await writeJsonIfMissing(pluginDataPath, DEFAULT_QUICKADD_DATA);
	}

	return {
		pluginPath,
		registered: false,
		trusted: false,
		verifiedQuickAdd: false,
		vaultName: options.vaultName,
		vaultPath: options.vaultPath,
		worktreePath: options.worktreePath,
	};
}

export async function registerVault(options) {
	if (!options.registerVia) return false;

	const code = [
		"(() => {",
		"const { ipcRenderer } = require('electron');",
		`return ipcRenderer.sendSync('vault-open', ${JSON.stringify(options.vaultPath)}, false);`,
		"})()",
	].join(" ");
	const { stdout } = await execFileAsync("obsidian", [
		`vault=${options.registerVia}`,
		"eval",
		`code=${code}`,
	]);

	if (!stdout.includes("=> true")) {
		throw new Error(
			`Obsidian did not confirm vault registration through ${options.registerVia}: ${stdout.trim()}`,
		);
	}

	return true;
}

export async function trustVaultAndVerifyQuickAdd(options) {
	if (!options.registerVia) return {
		trusted: false,
		verifiedQuickAdd: false,
	};

	await execFileAsync("obsidian", [
		`vault=${options.vaultName}`,
		"plugins:restrict",
		"off",
	]);

	const deadline = Date.now() + QUICKADD_VERIFY_TIMEOUT_MS;
	let lastError = "";
	while (Date.now() < deadline) {
		try {
			const { stdout } = await execFileAsync("obsidian", [
				`vault=${options.vaultName}`,
				"quickadd:list",
			]);
			if (stdout.includes("\"ok\":true")) {
				return {
					trusted: true,
					verifiedQuickAdd: true,
				};
			}
			lastError = stdout.trim();
		} catch (error) {
			lastError = error?.stderr?.trim() || error?.stdout?.trim() || error?.message || String(error);
		}
		await new Promise((resolve) => setTimeout(resolve, QUICKADD_VERIFY_INTERVAL_MS));
	}

	throw new Error(
		`QuickAdd commands did not become available in ${options.vaultName} after disabling restricted mode. Last error: ${lastError}`,
	);
}

export function toShellExports(result) {
	return [
		`export QUICKADD_E2E_VAULT=${shellQuote(result.vaultName)}`,
		`export QUICKADD_E2E_VAULT_PATH=${shellQuote(result.vaultPath)}`,
	].join("\n");
}

function shellQuote(value) {
	return `'${String(value).replaceAll("'", "'\\''")}'`;
}

async function main() {
	const rawOptions = parseArgs(process.argv.slice(2));
	if (rawOptions.help) {
		printUsage();
		return;
	}

	const options = resolveProvisionOptions(rawOptions);
	const result = await provisionVault(options);
	result.registered = await registerVault(options);
	const trustResult = await trustVaultAndVerifyQuickAdd(options);
	result.trusted = trustResult.trusted;
	result.verifiedQuickAdd = trustResult.verifiedQuickAdd;

	if (options.json) {
		console.log(JSON.stringify(result, null, 2));
	} else {
		console.log(`Provisioned Obsidian E2E vault ${result.vaultName}`);
		console.log(`Vault path: ${result.vaultPath}`);
		console.log(`QuickAdd plugin: ${result.pluginPath}`);
		if (result.registered) {
			console.log(`Registered via vault: ${options.registerVia}`);
		}
		if (result.trusted) {
			console.log("Restricted mode: off");
		}
		if (result.verifiedQuickAdd) {
			console.log("QuickAdd command check: ok");
		}
	}

	if (options.printEnv) {
		console.log(toShellExports(result));
	}
}

if (import.meta.url === `file://${process.argv[1]}`) {
	main().catch((error) => {
		console.error(error instanceof Error ? error.message : error);
		process.exitCode = 1;
	});
}
