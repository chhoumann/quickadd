/**
 * Runtime symlink/realpath write guard for untrusted-input vault writers.
 *
 * Shared by the AI built-in vault writers (#714) and the package-import asset
 * writer — both write data the user did not author byte-for-byte (model output /
 * an imported community package), so both must confine writes to the vault.
 *
 * Lexical string sanitization (sanitizeVaultPath / validateAssetDestination) is
 * not enough: Obsidian's desktop adapter follows symlinks, so a write to an
 * in-vault symlink can land OUTSIDE the vault while a confirm shows an in-vault
 * path (runtime-proven in review). This resolves the realpath of the target (or
 * its nearest existing ancestor, since the file may not exist yet) and the vault
 * root, and throws if the target is not contained.
 *
 * Desktop only — FileSystemAdapter + Node fs/path are accessed lazily via
 * `window.require` so the mobile bundle (no symlinks, no require) is never affected.
 */
import { FileSystemAdapter, type App } from "obsidian";

export class VaultWriteEscapeError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "VaultWriteEscapeError";
	}
}

// Minimal shapes (avoid a top-level `import ... from "fs"` so the mobile bundle,
// which has no Node builtins, is never affected — fs/path are required lazily).
interface NodeFs {
	promises: { realpath(p: string): Promise<string> };
	lstatSync(p: string): unknown;
}
interface NodePath {
	dirname(p: string): string;
	relative(from: string, to: string): string;
	isAbsolute(p: string): boolean;
	sep: string;
}

function nodeRequire<T>(mod: string): T | null {
	try {
		const req = (window as unknown as { require?: (m: string) => unknown })
			.require;
		return req ? (req(mod) as T) : null;
	} catch {
		return null;
	}
}

export async function assertWriteStaysInVault(
	app: App,
	vaultRelativePath: string,
): Promise<void> {
	const adapter = app.vault.adapter;
	// `typeof` guard: FileSystemAdapter is absent on mobile and in the test stub —
	// `instanceof undefined` would throw, so check the symbol is a constructor first.
	if (typeof FileSystemAdapter !== "function" || !(adapter instanceof FileSystemAdapter)) {
		return; // mobile / no real FS — string sanitization is the only guard there
	}

	const fs = nodeRequire<NodeFs>("fs");
	const path = nodeRequire<NodePath>("path");
	if (!fs?.promises || !path) return; // can't verify — fail open only when fs is unavailable

	const realBase = await fs.promises.realpath(adapter.getBasePath());
	const targetFull = adapter.getFullPath(vaultRelativePath);

	// Walk up to the nearest path that actually exists; resolve ITS realpath. Any
	// symlink in the existing chain (pointing outside the vault) surfaces here. The
	// not-yet-created tail is plain, already-sanitized names, so it cannot escape.
	let probe = targetFull;
	while (!exists(fs, probe)) {
		const parent = path.dirname(probe);
		if (parent === probe) break;
		probe = parent;
	}

	let realTarget: string;
	try {
		realTarget = await fs.promises.realpath(probe);
	} catch {
		// `probe` exists (lstatSync above) yet cannot be resolved: it is, or passes
		// through, a DANGLING symlink whose ultimate target does not exist. A write
		// still FOLLOWS that symlink and can land outside the vault, and we cannot
		// prove where — so fail CLOSED. (On Linux/glibc realpath throws ENOENT here;
		// the previous `.catch(() => probe)` fallback trusted the unresolved in-vault
		// path and let the escape through.)
		throw new VaultWriteEscapeError(
			`Refusing to write to "${vaultRelativePath}": it resolves through an unresolvable (dangling) symlink.`,
		);
	}
	const rel = path.relative(realBase, realTarget);
	const escapes = rel === ".." || rel.startsWith(`..${path.sep}`) || path.isAbsolute(rel);
	if (escapes) {
		throw new VaultWriteEscapeError(
			`Refusing to write to "${vaultRelativePath}": it resolves (via a symlink) outside the vault.`,
		);
	}

	// Reject a target that RESOLVES into a dot/config directory (.obsidian, .git,
	// .trash, ...) even though it stays inside the vault. The lexical per-segment
	// dot-floor only sees the LITERAL destination, so a pre-existing in-vault
	// symlink like `safe -> .obsidian/plugins/pkg` would otherwise smuggle an
	// untrusted "safe/main.js" write into a config/executable directory. Checking
	// the realpath-resolved segments closes that symlink-mediated config-dir drop.
	const resolvedEscapesIntoConfigDir = rel
		.split(path.sep)
		.some((segment) => segment.startsWith("."));
	if (resolvedEscapesIntoConfigDir) {
		throw new VaultWriteEscapeError(
			`Refusing to write to "${vaultRelativePath}": it resolves (via a symlink) into a config/hidden directory.`,
		);
	}
}

function exists(fs: NodeFs, p: string): boolean {
	try {
		fs.lstatSync(p);
		return true;
	} catch {
		return false;
	}
}
