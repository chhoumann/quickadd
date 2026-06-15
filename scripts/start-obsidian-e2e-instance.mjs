#!/usr/bin/env node
import crypto from "node:crypto";
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { promisify } from "node:util";
import {
	provisionVault,
	resolveProvisionOptions,
	toShellExports,
} from "./provision-obsidian-e2e-vault.mjs";

const execFileAsync = promisify(execFile);
const DEFAULT_PROFILE_ROOT = "/tmp/quickadd-obsidian-e2e";
const DEFAULT_OBSIDIAN_APP = "Obsidian";
const DEFAULT_OBSIDIAN_BIN = "obsidian";
const READY_TIMEOUT_MS = 30_000;
const READY_INTERVAL_MS = 500;

function printUsage() {
	console.log(`Usage: node scripts/start-obsidian-e2e-instance.mjs [options]

Options:
  --vault <name>        Vault/profile name. Defaults to quickadd-<worktree>.
  --root <path>         Directory that contains provisioned vaults. Defaults to .obsidian-e2e-vaults.
  --worktree <path>     QuickAdd worktree to link plugin files from. Defaults to cwd.
  --data <path>         Optional QuickAdd data.json seed to copy on first provision.
  --profile-root <path> Directory for per-vault Obsidian HOME profiles. Defaults to /tmp/quickadd-obsidian-e2e.
  --obsidian-app <name> Obsidian app name for macOS open. Defaults to Obsidian.
  --obsidian-bin <path> Obsidian CLI executable. Defaults to obsidian.
  --force               Recreate plugin symlinks if they already exist.
  --no-launch           Prepare the profile and vault without launching Obsidian.
  --print-env           Print exports for running e2e tests against this instance.
  --json                Print a machine-readable summary.
  --help                Show this help.
`);
}

export function parseArgs(argv) {
	const options = {
		force: false,
		json: false,
		launch: true,
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
			case "--no-launch":
				options.launch = false;
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
			case "--profile-root":
			case "--obsidian-app":
			case "--obsidian-bin": {
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
	if (arg === "--profile-root") return "profileRoot";
	if (arg === "--obsidian-app") return "obsidianApp";
	if (arg === "--obsidian-bin") return "obsidianBin";
	return arg.slice(2);
}

export function resolveInstanceOptions(rawOptions, cwd = process.cwd()) {
	const provisionOptions = resolveProvisionOptions(rawOptions, cwd);
	const profileRoot = path.resolve(cwd, rawOptions.profileRoot ?? DEFAULT_PROFILE_ROOT);
	const instanceId = stableInstanceId(provisionOptions.worktreePath, provisionOptions.vaultName);
	const instancePath = path.join(profileRoot, instanceId);
	const obsidianHome = path.join(instancePath, "home");

	return {
		...provisionOptions,
		instanceId,
		instancePath,
		launch: rawOptions.launch ?? true,
		obsidianApp: rawOptions.obsidianApp ?? DEFAULT_OBSIDIAN_APP,
		obsidianBin: rawOptions.obsidianBin ?? DEFAULT_OBSIDIAN_BIN,
		obsidianHome,
		profileRoot,
	};
}

function stableInstanceId(worktreePath, vaultName) {
	const hash = crypto
		.createHash("sha256")
		.update(`${path.resolve(worktreePath)}\0${vaultName}`)
		.digest("hex")
		.slice(0, 12);
	return `${safeName(vaultName).slice(0, 32)}-${hash}`;
}

function safeName(value) {
	return value
		.toLowerCase()
		.replace(/[^a-z0-9._-]+/g, "-")
		.replace(/^-+|-+$/g, "") || "vault";
}

export async function prepareObsidianProfile(options) {
	const userDataPath = path.join(options.obsidianHome, "Library", "Application Support", "obsidian");
	await fs.mkdir(userDataPath, { recursive: true, mode: 0o700 });
	await fs.mkdir(path.join(options.obsidianHome, "Library", "Logs"), { recursive: true, mode: 0o700 });
	await linkHostKeychains(options);

	const vaultId = stableVaultId(options.vaultPath);
	const obsidianJsonPath = path.join(userDataPath, "obsidian.json");
	await writeJson(obsidianJsonPath, {
		cli: true,
		updateDisabled: true,
		vaults: {
			[vaultId]: {
				open: true,
				path: options.vaultPath,
				ts: Date.now(),
			},
		},
	});

	return {
		obsidianJsonPath,
		userDataPath,
		vaultId,
	};
}

async function linkHostKeychains(options) {
	const realHome = process.env.HOME;
	if (!realHome) return;

	const source = path.join(realHome, "Library", "Keychains");
	const destination = path.join(options.obsidianHome, "Library", "Keychains");
	try {
		await fs.lstat(source);
	} catch (error) {
		if (error?.code === "ENOENT") return;
		throw error;
	}

	try {
		const stat = await fs.lstat(destination);
		if (!stat.isSymbolicLink()) return;
		const target = await fs.readlink(destination);
		if (path.resolve(path.dirname(destination), target) === source) return;
		await fs.unlink(destination);
	} catch (error) {
		if (error?.code !== "ENOENT") throw error;
	}

	await fs.mkdir(path.dirname(destination), { recursive: true });
	await fs.symlink(source, destination);
}

function stableVaultId(vaultPath) {
	return crypto
		.createHash("sha256")
		.update(path.resolve(vaultPath))
		.digest("hex")
		.slice(0, 16);
}

async function writeJson(filePath, value) {
	await fs.mkdir(path.dirname(filePath), { recursive: true, mode: 0o700 });
	try {
		const stat = await fs.lstat(filePath);
		if (stat.isSymbolicLink() || !stat.isFile()) {
			throw new Error(`${filePath} exists but is not a regular file.`);
		}
	} catch (error) {
		if (error?.code !== "ENOENT") throw error;
	}
	await fs.writeFile(filePath, `${JSON.stringify(value, null, "\t")}\n`, {
		mode: 0o600,
	});
}

export async function launchObsidianInstance(options) {
	await fs.mkdir(options.instancePath, { recursive: true });
	await execFileAsync("/usr/bin/open", [
		"-n",
		"-g",
		"-a",
		options.obsidianApp,
		"--env",
		`HOME=${options.obsidianHome}`,
		"--args",
		`--user-data-dir=${options.userDataPath}`,
		"--password-store=basic",
	], {
		env: obsidianEnv(options),
	});

	return {
		pid: null,
		pidPath: null,
	};
}

function obsidianEnv(options) {
	return {
		...process.env,
		HOME: options.obsidianHome,
	};
}

async function execObsidian(options, args, execOptions = {}) {
	return execFileAsync(options.obsidianBin, args, {
		env: obsidianEnv(options),
		...execOptions,
	});
}

export async function waitForInstanceReady(options) {
	const expectedPath = path.resolve(options.vaultPath);
	const deadline = Date.now() + READY_TIMEOUT_MS;
	let lastError = "";

	while (Date.now() < deadline) {
		try {
			const { stdout } = await execObsidian(options, [
				`vault=${options.vaultName}`,
				"vault",
				"info=path",
			]);
			const actualPath = path.resolve(stdout.trim());
			if (actualPath === expectedPath) return actualPath;
			lastError = `resolved ${actualPath}, expected ${expectedPath}`;
		} catch (error) {
			lastError = error?.stderr?.trim() || error?.stdout?.trim() || error?.message || String(error);
		}
		await sleep(READY_INTERVAL_MS);
	}

	throw new Error(`Obsidian instance did not become ready for ${options.vaultName}. Last error: ${lastError}`);
}

export async function trustVaultAndVerifyQuickAdd(options) {
	await execObsidian(options, [
		`vault=${options.vaultName}`,
		"plugins:restrict",
		"off",
	]);

	const deadline = Date.now() + READY_TIMEOUT_MS;
	let lastError = "";
	while (Date.now() < deadline) {
		try {
			const { stdout } = await execObsidian(options, [
				`vault=${options.vaultName}`,
				"quickadd:list",
			]);
			if (stdout.includes("\"ok\":true")) return true;
			lastError = stdout.trim();
		} catch (error) {
			lastError = error?.stderr?.trim() || error?.stdout?.trim() || error?.message || String(error);
		}
		await sleep(READY_INTERVAL_MS);
	}

	throw new Error(`QuickAdd did not become available in ${options.vaultName}. Last error: ${lastError}`);
}

function sleep(ms) {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

export function toInstanceShellExports(result) {
	return [
		toShellExports(result),
		`export QUICKADD_E2E_OBSIDIAN_HOME=${shellQuote(result.obsidianHome)}`,
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

	const options = resolveInstanceOptions(rawOptions);
	const provisionResult = await provisionVault(options);
	const profileResult = await prepareObsidianProfile(options);
	options.userDataPath = profileResult.userDataPath;
	const launchResult = options.launch
		? await launchObsidianInstance(options)
		: { pid: null, pidPath: null };
	const resolvedVaultPath = options.launch
		? await waitForInstanceReady(options)
		: null;
	const verifiedQuickAdd = options.launch
		? await trustVaultAndVerifyQuickAdd(options)
		: false;
	const result = {
		...provisionResult,
		...profileResult,
		...launchResult,
		obsidianHome: options.obsidianHome,
		resolvedVaultPath,
		verifiedQuickAdd,
	};

	if (rawOptions.json) {
		console.log(JSON.stringify(result, null, 2));
	} else {
		console.log(`Prepared Obsidian E2E instance ${result.vaultName}`);
		console.log(`Vault path: ${result.vaultPath}`);
		console.log(`Obsidian HOME: ${result.obsidianHome}`);
		if (result.pid) console.log(`Obsidian PID: ${result.pid}`);
		if (result.verifiedQuickAdd) console.log("QuickAdd command check: ok");
	}

	if (rawOptions.printEnv) {
		console.log(toInstanceShellExports(result));
	}
}

if (import.meta.url === `file://${process.argv[1]}`) {
	main().catch((error) => {
		console.error(error instanceof Error ? error.message : error);
		process.exitCode = 1;
	});
}
