/**
 * Realpath write guard for vault writers of untrusted data (AI built-in
 * writers, package import). Lexical sanitization is not enough: Obsidian's
 * desktop adapter follows symlinks, so an in-vault symlink can land a write
 * outside the vault. This resolves the realpath of the target (or its nearest
 * existing ancestor) and of the vault root, and throws unless contained.
 * Desktop only; fs/path load lazily so the mobile bundle is unaffected.
 */
import { FileSystemAdapter, type App } from "obsidian";
import { nodeRequire } from "./nodeRequire";

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
		// `probe` exists yet cannot be resolved: it is, or passes through, a
		// dangling symlink. A write would still follow it and could land outside
		// the vault, so fail closed. Linux realpath throws ENOENT here.
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
