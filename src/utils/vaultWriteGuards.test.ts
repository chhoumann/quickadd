import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import type { App } from "obsidian";
import { FileSystemAdapter } from "obsidian";
import {
	assertWriteStaysInVault,
	VaultWriteEscapeError,
} from "./vaultWriteGuards";

/**
 * Exercises the REAL realpath/symlink containment with an actual on-disk
 * symlink — not a mocked throw. The guard only engages when the adapter is a
 * FileSystemAdapter and `window.require("fs"/"path")` yields real Node modules,
 * so we shim both locally (restored in afterEach) and back the adapter with a
 * temp vault directory.
 */
describe("assertWriteStaysInVault (real symlink containment)", () => {
	let tmpRoot: string;
	let vaultDir: string;
	let outsideDir: string;
	let app: App;

	beforeEach(() => {
		tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "qa-guard-"));
		vaultDir = path.join(tmpRoot, "vault");
		outsideDir = path.join(tmpRoot, "outside");
		fs.mkdirSync(vaultDir);
		fs.mkdirSync(outsideDir);

		// Escape symlink: vault/linked -> ../outside (outside the vault).
		fs.symlinkSync(outsideDir, path.join(vaultDir, "linked"), "dir");
		// In-vault symlink: vault/linkdir -> vault/realdir (stays inside).
		const realdir = path.join(vaultDir, "realdir");
		fs.mkdirSync(realdir);
		fs.symlinkSync(realdir, path.join(vaultDir, "linkdir"), "dir");

		// The real obsidian FileSystemAdapter constructor is 0-arg in the .d.ts;
		// the test stub takes a base path. Cast the ctor so tsc (which type-checks
		// against the real types) accepts it while runtime uses the stub.
		const AdapterCtor = FileSystemAdapter as unknown as new (
			basePath: string,
		) => FileSystemAdapter;
		const adapter = new AdapterCtor(vaultDir);
		app = { vault: { adapter } } as unknown as App;

		(window as unknown as { require: (m: string) => unknown }).require = (
			mod: string,
		) => {
			if (mod === "fs") return fs;
			if (mod === "path") return path;
			throw new Error(`unexpected require(${mod})`);
		};
	});

	afterEach(() => {
		delete (window as unknown as { require?: unknown }).require;
		fs.rmSync(tmpRoot, { recursive: true, force: true });
	});

	it("rejects a write that resolves through a symlink to outside the vault", async () => {
		await expect(
			assertWriteStaysInVault(app, "linked/evil.js"),
		).rejects.toBeInstanceOf(VaultWriteEscapeError);
	});

	it("allows a write through an in-vault symlink (no over-rejection)", async () => {
		await expect(
			assertWriteStaysInVault(app, "linkdir/ok.js"),
		).resolves.toBeUndefined();
	});

	it("allows a plain in-vault path", async () => {
		await expect(
			assertWriteStaysInVault(app, "notes/new.md"),
		).resolves.toBeUndefined();
	});

	it("is a no-op when the adapter is not a FileSystemAdapter (mobile/tests)", async () => {
		const plainApp = { vault: { adapter: {} } } as unknown as App;
		await expect(
			assertWriteStaysInVault(plainApp, "../escape.js"),
		).resolves.toBeUndefined();
	});

	it("rejects a write through a DANGLING in-vault symlink (target not yet created)", async () => {
		// out.md -> ../outside/new.md, where new.md does NOT exist. A write still
		// follows the symlink and lands outside. (macOS realpath resolves the path
		// and the escape is caught; Linux realpath throws ENOENT and the fail-closed
		// branch catches it — both must reject.)
		fs.symlinkSync(
			path.join(outsideDir, "new.md"),
			path.join(vaultDir, "out.md"),
			"file",
		);
		await expect(
			assertWriteStaysInVault(app, "out.md"),
		).rejects.toBeInstanceOf(VaultWriteEscapeError);
	});

	it("fails closed when realpath cannot resolve an existing target (Linux ENOENT path)", async () => {
		// Deterministically exercise the fail-closed branch on every platform: the
		// target exists (lstat) but realpath throws. The pre-fix `.catch(() =>
		// probe)` fallback trusted the unresolved in-vault path and let it through.
		const base = vaultDir;
		const shimFs = {
			promises: {
				realpath: async (p: string) => {
					if (p === base) return base;
					throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
				},
			},
			lstatSync: () => ({}),
		};
		(window as unknown as { require: (m: string) => unknown }).require = (
			mod: string,
		) => {
			if (mod === "fs") return shimFs;
			if (mod === "path") return path;
			throw new Error(`unexpected require(${mod})`);
		};
		const AdapterCtor = FileSystemAdapter as unknown as new (
			basePath: string,
		) => FileSystemAdapter;
		const shimApp = {
			vault: { adapter: new AdapterCtor(base) },
		} as unknown as App;
		await expect(
			assertWriteStaysInVault(shimApp, "out.md"),
		).rejects.toBeInstanceOf(VaultWriteEscapeError);
	});
});
