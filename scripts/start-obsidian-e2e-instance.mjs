#!/usr/bin/env node
import crypto from "node:crypto";
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
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
// Sidecar written at the instance root recording which worktree the instance
// belongs to. The teardown reaper reads it to reap an instance only once its
// worktree is gone (a removed/merged worktree) — the reliable leak signal.
export const INSTANCE_MARKER_FILE = "quickadd-e2e-instance.json";
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

// The uid we require every profile directory to be owned by. Injectable so the
// foreign-owner branch is testable without a second account; null on a platform
// without process.getuid (none we support — the harness is macOS-only) skips the
// ownership check rather than comparing against undefined.
function resolveCurrentUid(options) {
	if ("currentUid" in options) return options.currentUid;
	return typeof process.getuid === "function" ? process.getuid() : null;
}

// Reject any directory we do not exclusively own. A directory we own with no
// group/other access cannot have a foreign-planted child (only we can write into
// it), so descending into it later is safe. We REJECT a loose (group/other-
// accessible) dir rather than chmod-repairing it: an attacker who could write
// while it was loose may already have planted a `home` symlink that a parent
// chmod would not undo, and a later recursive mkdir / keychain link would follow.
function assertOwnedDir(dir, stat, currentUid) {
	if (stat.isSymbolicLink() || !stat.isDirectory()) {
		throw new Error(
			`Refusing to use ${dir}: it is a symlink or not a regular directory.`,
		);
	}
	if (currentUid !== null && stat.uid !== currentUid) {
		throw new Error(
			`Refusing to use ${dir}: owned by uid ${stat.uid}, not ${currentUid}.`,
		);
	}
	if ((stat.mode & 0o077) !== 0) {
		throw new Error(
			`Refusing to use ${dir}: it is group/other-accessible (mode ${(
				stat.mode & 0o777
			).toString(8)}); remove it and retry.`,
		);
	}
}

// Create (when absent) and validate a private profile directory we own. The
// profile root defaults under world-writable /tmp; if a co-located actor
// pre-creates it (or symlinks it elsewhere) before our first run,
// fs.mkdir(..., {recursive}) is a no-op for ownership/mode and we would
// otherwise write the keychain-bearing HOME (and obsidian.json) through their
// directory. lstat FIRST so we never mkdir THROUGH a pre-existing symlink, then
// create only when absent, then assert ownership/mode. Callers must secure a
// parent before its children so each child is created inside an already-0o700
// tree the attacker cannot enter (and /tmp's sticky bit then prevents swapping
// our owned dir entry).
export async function ensureSecureDir(dir, options = {}) {
	const currentUid = resolveCurrentUid(options);
	let stat;
	try {
		stat = await fs.lstat(dir);
	} catch (error) {
		if (error?.code !== "ENOENT") throw error;
		await fs.mkdir(dir, { recursive: true, mode: 0o700 });
		stat = await fs.lstat(dir);
	}
	assertOwnedDir(dir, stat, currentUid);
	return dir;
}

// Validate an EXISTING profile directory without creating or modifying it.
// Teardown paths (stop/reap) read and remove inside the root, so they must
// refuse a hijacked/symlinked root, but must not create one — a missing root
// just means there is nothing to clean up. Returns false when the path is absent.
export async function assertSecureDirIfPresent(dir, options = {}) {
	const currentUid = resolveCurrentUid(options);
	let stat;
	try {
		stat = await fs.lstat(dir);
	} catch (error) {
		if (error?.code === "ENOENT") return false;
		throw error;
	}
	assertOwnedDir(dir, stat, currentUid);
	return true;
}

export async function prepareObsidianProfile(options) {
	// Fail closed if our profile tree is not a private directory we own
	// (temp-squat / TOCTOU guard). Secure the root before the instance dir so the
	// instance dir is created inside an already-validated 0o700 tree.
	await ensureSecureDir(options.profileRoot);
	await ensureSecureDir(options.instancePath);

	const userDataPath = path.join(options.obsidianHome, "Library", "Application Support", "obsidian");
	await fs.mkdir(userDataPath, { recursive: true, mode: 0o700 });
	await fs.mkdir(path.join(options.obsidianHome, "Library", "Logs"), { recursive: true, mode: 0o700 });
	// One resolution feeds BOTH the sandbox seeding and the marker, so what a
	// fresh instance will run and what reuse checks compare are the same value
	// (see readInstanceMarker / the CLI's reuse guard).
	const resolvedApp = await resolveObsidianAppVersion(options);
	await reconcileSandboxAppAsar(userDataPath, resolvedApp.newestCachedAsar);
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

	// Record which worktree this instance belongs to so the teardown reaper can
	// reap it once that worktree is removed (see INSTANCE_MARKER_FILE). The
	// marker's appVersion is the LAUNCH-TIME version of the running instance
	// (stamped by stampInstanceMarkerAppVersion after a successful launch), so
	// re-preparing the profile must PRESERVE it — overwriting it with the fresh
	// prediction here would blind the CLI's reuse guard on its second run: the
	// first mismatch failure would already have rewritten the marker to the new
	// version, and the still-running old instance would then look current.
	const existingMarker = await readInstanceMarker(options.instancePath);
	await writeJson(path.join(options.instancePath, INSTANCE_MARKER_FILE), {
		worktreePath: options.worktreePath,
		vaultName: options.vaultName,
		vaultPath: options.vaultPath,
		appVersion: existingMarker?.appVersion ?? null,
	});

	return {
		obsidianJsonPath,
		userDataPath,
		vaultId,
		appVersion: resolvedApp.appVersion,
	};
}

/** Read an instance's marker sidecar; null when absent/unreadable (no instance
 * yet, or a marker written by an older harness without the field callers want). */
export async function readInstanceMarker(instancePath) {
	try {
		return JSON.parse(
			await fs.readFile(path.join(instancePath, INSTANCE_MARKER_FILE), "utf8"),
		);
	} catch {
		return null;
	}
}

/** Stamp the app-code version the instance was actually LAUNCHED with into the
 * marker. Called only after a successful launch — never from profile prep — so
 * the CLI's reuse guard keeps seeing the running instance's launch-time version
 * across any number of prepare cycles. */
export async function stampInstanceMarkerAppVersion(instancePath, appVersion) {
	const marker = await readInstanceMarker(instancePath);
	if (!marker) return;
	await writeJson(path.join(instancePath, INSTANCE_MARKER_FILE), {
		...marker,
		appVersion: appVersion ?? null,
	});
}

// The launched instance resolves its app-code asar from ITS OWN config dir:
// $HOME is overridden to the sandbox, so the real config dir's auto-updated
// obsidian-<version>.asar is invisible to it and it silently boots the OLDER
// bundled installer build (verified live: real config had 1.13.0, the sandbox
// instance ran 1.12.7 and could not render declarative settings tabs). That is
// exactly the divergence the minAppVersion guard below predicts against — the
// guard resolves from the REAL config dir — so make the sandbox match the
// prediction: remove any stale sandbox asars (a leftover from an older run
// could otherwise outrank the predicted version), then copy the exact asar the
// resolver selected. Copy, not symlink: Obsidian manages (rewrites/deletes)
// asars next to obsidian.json. A failed copy THROWS — succeeding silently
// would let the guard pass while the instance boots something else. With no
// cached asar at all the sandbox is left clean and the instance runs the
// bundled installer build, which the guard still validates against
// minAppVersion.
async function reconcileSandboxAppAsar(userDataPath, newestCachedAsar) {
	for (const name of await fs.readdir(userDataPath)) {
		if (!OBSIDIAN_ASAR_VERSION_RE.test(name)) continue;
		if (newestCachedAsar && name === newestCachedAsar.name) continue;
		await fs.rm(path.join(userDataPath, name), { force: true });
	}
	if (!newestCachedAsar) return null;

	const destination = path.join(userDataPath, newestCachedAsar.name);
	try {
		// Already seeded by a previous run (same name + size): skip the copy so
		// per-command CLI calls don't rewrite ~25MB under a running instance.
		const [source, existing] = await Promise.all([
			fs.stat(newestCachedAsar.path),
			fs.stat(destination),
		]);
		if (source.size === existing.size) return newestCachedAsar.version;
	} catch {
		// Destination missing — fall through to the copy.
	}
	await fs.copyFile(newestCachedAsar.path, destination);
	return newestCachedAsar.version;
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
	// Validate (and create when absent) the profile tree here too, so a future
	// "relaunch existing instance" path that calls launch without the normal
	// prepareObsidianProfile/main preflight cannot bypass the temp-squat guard.
	// Parent-first: a loose profileRoot must not stay attacker-writable around
	// the validated instance dir.
	await ensureSecureDir(options.profileRoot);
	await ensureSecureDir(options.instancePath);
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

// --- minAppVersion guard ------------------------------------------------------
//
// Obsidian has TWO versions: the installer shell (the .app, shown in the window
// title) and the auto-updated app code (obsidian-<version>.asar, == the
// `apiVersion` plugins see). minAppVersion is enforced against the app-code
// version, not the installer. The app-code asar is resolved from the config
// dir of the HOME the app runs under — for this harness that is the ISOLATED
// sandbox home (verified live: with an empty sandbox the instance booted the
// bundled installer build even though the real config dir held a newer asar),
// so prepareObsidianProfile seeds the newest real-config asar into the sandbox
// (seedNewestObsidianAsar) and the instance loads that, floored at the
// installer's bundled asar. When NO installed asar reaches minAppVersion,
// Obsidian silently runs the bundled installer build, which can be BELOW
// minAppVersion. e2e then runs against an app QuickAdd does not support, so a
// "missing API" crash there is a false signal (this is exactly what makes a
// 1.13.0-only call like ButtonComponent.setDestructive look "absent on 1.13.0").
// This guard resolves the real app-code version and fails loudly when it is
// below the plugin's declared minAppVersion.
//
// Why predict from disk instead of querying the live instance: Obsidian does not
// expose `apiVersion` to a CDP-evaluated snippet (require("obsidian") is not
// resolvable outside plugin scope, and the window title carries the INSTALLER
// version, not the app-code version), so the app-code version cannot be read from
// the running renderer. We therefore resolve it from the same inputs the seeding
// uses — the newest valid installed asar in the real config dir, floored at the
// bundled installer asar. The guard runs BEFORE launch, and prepareObsidianProfile
// seeds that same asar into the sandbox, so a fresh instance loads exactly
// what we resolved. A warm instance reused from an earlier run reflects the
// asar resolution at ITS launch — the instance marker records that version and
// the CLI's reuse guard refuses to reuse when it no longer matches a fresh
// resolution (an Obsidian update mid-session forces an explicit restart).

const OBSIDIAN_ASAR_VERSION_RE = /^obsidian-(\d+\.\d+\.\d+)\.asar$/;

function macObsidianConfigDir() {
	return path.join(
		os.userInfo().homedir,
		"Library",
		"Application Support",
		"obsidian",
	);
}

// Only consulted as the floor when the config dir has no usable cached asar
// (a fresh machine / CI that never auto-updated). Standard install locations
// only — a bundle registered elsewhere with an empty cache resolves to null and
// the guard then refuses to run blind rather than guess.
function bundledAsarCandidates(obsidianApp) {
	const leaf = path.join(
		`${obsidianApp}.app`,
		"Contents",
		"Resources",
		"obsidian.asar",
	);
	return [
		path.join("/Applications", leaf),
		path.join(os.userInfo().homedir, "Applications", leaf),
	];
}

// Numeric 3-part compare; ignores any pre-release suffix. >0 if a>b, 0, <0.
export function compareObsidianVersions(a, b) {
	const parse = (v) => {
		const m = String(v).match(/(\d+)\.(\d+)\.(\d+)/);
		return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : [0, 0, 0];
	};
	const x = parse(a);
	const y = parse(b);
	return x[0] - y[0] || x[1] - y[1] || x[2] - y[2];
}

// Read the `version` from an asar archive's package.json without unpacking it.
// Returns null on any malformed/missing input (never throws) so a stray file in
// the config dir cannot break the guard.
//
// asar layout: [size pickle (8 bytes)] [header pickle] [file data]. The size
// pickle's payload (byte 4, UInt32LE) is the header pickle's byte length, so file
// data begins at 8 + headerPickleLength. The header pickle wraps a Pickle string:
// its raw length is at byte 12 and its JSON bytes start at byte 16. Pickle
// 4-byte-aligns the string, so the data base must come from the header pickle
// length, NOT `16 + jsonLength` (which lands in the alignment padding when the
// JSON length is not a multiple of 4).
async function readAsarPackageVersion(asarPath) {
	let handle;
	try {
		handle = await fs.open(asarPath, "r");
		const head = Buffer.alloc(16);
		await handle.read(head, 0, 16, 0);
		const headerPickleLength = head.readUInt32LE(4);
		const jsonLength = head.readUInt32LE(12);
		if (!Number.isInteger(jsonLength) || jsonLength <= 0 || jsonLength > 64 * 1024 * 1024) {
			return null;
		}
		const dataBase = 8 + headerPickleLength;
		const headerBuf = Buffer.alloc(jsonLength);
		await handle.read(headerBuf, 0, jsonLength, 16);
		const header = JSON.parse(headerBuf.toString("utf8"));
		const entry = header?.files?.["package.json"];
		if (!entry) return null;
		const size = Number(entry.size);
		const offset = Number(entry.offset);
		if (!Number.isFinite(size) || !Number.isFinite(offset) || size <= 0) return null;
		const fileBuf = Buffer.alloc(size);
		await handle.read(fileBuf, 0, size, dataBase + offset);
		const version = JSON.parse(fileBuf.toString("utf8"))?.version;
		return typeof version === "string" ? version : null;
	} catch {
		return null;
	} finally {
		await handle?.close().catch(() => {});
	}
}

// Resolve the Obsidian app-code version that the launched instance runs:
// the newest installed obsidian-*.asar in the real config dir, floored at the
// bundled installer asar. configDir/bundledAsarCandidates are injectable for
// tests. appVersion is null when no version can be determined at all.
export async function resolveObsidianAppVersion(options = {}) {
	const obsidianApp = options.obsidianApp ?? DEFAULT_OBSIDIAN_APP;
	const configDir = options.obsidianConfigDir ?? macObsidianConfigDir();

	const cachedVersions = [];
	// The single authority for "which cached asar is newest" — the seeding step
	// (reconcileSandboxAppAsar) copies exactly this file, so the guard's
	// prediction and the seeded sandbox cannot diverge by construction.
	let newestCachedAsar = null;
	try {
		for (const name of await fs.readdir(configDir)) {
			if (!OBSIDIAN_ASAR_VERSION_RE.test(name)) continue;
			// Trust the asar's own package.json, not the filename: a partial/corrupt
			// download parses to null and is skipped (Obsidian would not load it
			// either), so a half-downloaded obsidian-<newer>.asar cannot make the
			// guard pass while the live app actually falls back to an older build.
			const version = await readAsarPackageVersion(path.join(configDir, name));
			if (!version) continue;
			cachedVersions.push(version);
			if (
				!newestCachedAsar ||
				compareObsidianVersions(version, newestCachedAsar.version) > 0
			) {
				newestCachedAsar = { name, path: path.join(configDir, name), version };
			}
		}
	} catch {
		// Config dir missing/unreadable — fall back to the bundled installer below.
	}

	let installerVersion = null;
	const candidates = options.bundledAsarCandidates ?? bundledAsarCandidates(obsidianApp);
	for (const candidate of candidates) {
		installerVersion = await readAsarPackageVersion(candidate);
		if (installerVersion) break;
	}

	const all = [...cachedVersions, installerVersion].filter(Boolean);
	const appVersion = all.length
		? all.reduce((max, v) => (compareObsidianVersions(v, max) > 0 ? v : max))
		: null;

	return { appVersion, installerVersion, cachedVersions, configDir, newestCachedAsar };
}

async function readPluginMinAppVersion(worktreePath) {
	const manifestPath = path.join(worktreePath, "manifest.json");
	const minAppVersion = JSON.parse(await fs.readFile(manifestPath, "utf8"))?.minAppVersion;
	if (typeof minAppVersion !== "string" || !/\d+\.\d+\.\d+/.test(minAppVersion)) {
		throw new Error(`manifest.json at ${manifestPath} has no usable minAppVersion.`);
	}
	return minAppVersion;
}

// Fail loudly when the running Obsidian app-code version is below the plugin's
// minAppVersion (or cannot be determined). Returns the resolved versions for the
// caller to surface. Filesystem-based: independent of the running instance.
export async function assertObsidianMeetsMinAppVersion(options) {
	const minAppVersion = await readPluginMinAppVersion(options.worktreePath);
	const { appVersion, installerVersion, configDir } = await resolveObsidianAppVersion(options);

	if (!appVersion) {
		throw new Error(
			`Could not determine the running Obsidian app version (no obsidian-*.asar in ${configDir} ` +
				`and no bundled installer asar found). Refusing to run e2e against an unknown build that may ` +
				`be below the plugin's minAppVersion ${minAppVersion}.`,
		);
	}

	if (compareObsidianVersions(appVersion, minAppVersion) < 0) {
		throw new Error(
			`Obsidian app version ${appVersion} is BELOW the plugin's minAppVersion ${minAppVersion}` +
				`${installerVersion ? ` (installer shell ${installerVersion})` : ""}. Obsidian fell back to a ` +
				`build QuickAdd does not support, so any e2e "missing API" failure here is a FALSE signal, not a ` +
				`real bug. Update Obsidian to >= ${minAppVersion} (install it, or let it download an ` +
				`obsidian-*.asar into ${configDir}) before running e2e.`,
		);
	}

	return { appVersion, installerVersion, minAppVersion };
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

// Self-healing safety net: before launching our own instance, reap any leaked
// instances whose backing worktree is gone (e.g. removed on merge without the
// orca archive hook running). Best-effort — a reap failure must never block a
// start. The reaper is imported lazily so the static module graph stays acyclic
// (the stop module imports our option resolver; we only need its reaper at
// runtime). Reap logs go to stderr so they never pollute the `export …` lines a
// `--print-env` run writes to stdout.
export async function reapStaleInstances(options) {
	try {
		const { reapOrphanedInstances } = await import(
			"./stop-obsidian-e2e-instance.mjs"
		);
		await reapOrphanedInstances({
			profileRoot: options.profileRoot,
			exceptInstancePath: options.instancePath,
			log: console.error,
		});
	} catch (error) {
		console.error(
			`Skipping stale-instance reap: ${error instanceof Error ? error.message : error}`,
		);
	}
}

async function main() {
	const rawOptions = parseArgs(process.argv.slice(2));
	if (rawOptions.help) {
		printUsage();
		return;
	}

	const options = resolveInstanceOptions(rawOptions);
	// Validate the profile root we own before the reaper scans/removes anything in
	// it, so a hijacked root aborts the run loudly instead of being trusted.
	await ensureSecureDir(options.profileRoot);
	await reapStaleInstances(options);
	const provisionResult = await provisionVault(options);
	const profileResult = await prepareObsidianProfile(options);
	options.userDataPath = profileResult.userDataPath;
	// Resolve and assert the Obsidian app-code version BEFORE launching: a build
	// below minAppVersion makes every "missing API" failure a false signal, so fail
	// loudly here rather than spawn a doomed sub-minimum instance (which would be
	// left running for later reuse) and hit a confusing "QuickAdd did not become
	// available" timeout. Filesystem-based, so it needs no running instance.
	const compatibility = options.launch
		? await assertObsidianMeetsMinAppVersion(options)
		: null;
	const launchResult = options.launch
		? await launchObsidianInstance(options)
		: { pid: null, pidPath: null };
	const resolvedVaultPath = options.launch
		? await waitForInstanceReady(options)
		: null;
	if (options.launch) {
		// The instance is up: record the app version it launched with (the
		// pre-launch resolution) for the CLI's warm-reuse guard.
		await stampInstanceMarkerAppVersion(
			options.instancePath,
			compatibility?.appVersion ?? null,
		);
	}
	const verifiedQuickAdd = options.launch
		? await trustVaultAndVerifyQuickAdd(options)
		: false;
	const result = {
		...provisionResult,
		...profileResult,
		...launchResult,
		...(compatibility ?? {}),
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
		if (result.appVersion) {
			const installer = result.installerVersion ? `, installer ${result.installerVersion}` : "";
			console.log(
				`Obsidian app version: ${result.appVersion}${installer} (plugin minAppVersion ${result.minAppVersion})`,
			);
		}
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
