import type { App } from "obsidian";
import { normalizePath } from "obsidian";
import { escapesVaultBoundary } from "../../utils/vaultPathBoundary";
import type {
	AssetImportMode,
	AssetImportDecision,
	ChoiceImportMode,
	ChoiceImportDecision,
	PackageAnalysis,
} from "../../services/packageImportService";

/**
 * The per-file and per-choice import decision model, extracted from
 * ImportPackageModal so the (fiddly) write/overwrite reconciliation and the
 * optimistic-vs-authoritative existence checking are pure and unit-testable.
 *
 * Everything here operates on plain immutable Maps; the modal holds the
 * `$state`-backed references and reassigns them, preserving Svelte reactivity.
 */

export type AssetConflict = PackageAnalysis["assetConflicts"][number];
export type ChoiceConflict = PackageAnalysis["choiceConflicts"][number];

export interface AssetDecisionState {
	mode: AssetImportMode;
	destinationPath: string;
	destinationExists: boolean;
}

export type AssetDecisions = Map<string, AssetDecisionState>;
export type ChoiceDecisions = Map<string, ChoiceImportMode>;

/** Path-existence probe a decision uses; injected so this module stays App-free. */
export type ExistsProbe = (path: string) => boolean;

// --- The one rule for asset mode --------------------------------------------

/**
 * Skip is sticky; otherwise the write/overwrite mode tracks whether the
 * destination currently exists. This is the single home for a rule that was
 * previously inlined in three places.
 */
export function reconcileMode(
	mode: AssetImportMode,
	exists: boolean,
): AssetImportMode {
	if (mode === "skip") return mode;
	if (exists && mode === "write") return "overwrite";
	if (!exists && mode === "overwrite") return "write";
	return mode;
}

/** A choice's `overwrite` is only meaningful when the choice already exists. */
export function effectiveChoiceMode(
	mode: ChoiceImportMode,
	exists: boolean,
): ChoiceImportMode {
	return !exists && mode === "overwrite" ? "import" : mode;
}

// --- Decision construction --------------------------------------------------

export function defaultAssetDecision(
	conflict: AssetConflict,
	destinationFor: (conflict: AssetConflict) => string,
	exists: ExistsProbe,
): AssetDecisionState {
	const destinationPath = destinationFor(conflict);
	const destinationExists = conflict.exists || exists(destinationPath);
	return {
		mode: destinationExists ? "overwrite" : "write",
		destinationPath,
		destinationExists,
	};
}

function fallbackDecision(
	originalPath: string,
	exists: ExistsProbe,
): AssetDecisionState {
	const destinationExists = exists(originalPath);
	return {
		mode: destinationExists ? "overwrite" : "write",
		destinationPath: originalPath,
		destinationExists,
	};
}

export function initAssetDecisions(
	conflicts: readonly AssetConflict[],
	destinationFor: (conflict: AssetConflict) => string,
	exists: ExistsProbe,
): AssetDecisions {
	const decisions: AssetDecisions = new Map();
	for (const conflict of conflicts) {
		decisions.set(
			conflict.originalPath,
			defaultAssetDecision(conflict, destinationFor, exists),
		);
	}
	return decisions;
}

export function resolveAssetDecision(
	decisions: AssetDecisions,
	conflict: AssetConflict,
	destinationFor: (conflict: AssetConflict) => string,
	exists: ExistsProbe,
): AssetDecisionState {
	return (
		decisions.get(conflict.originalPath) ??
		defaultAssetDecision(conflict, destinationFor, exists)
	);
}

export function initChoiceDecisions(
	conflicts: readonly ChoiceConflict[],
): ChoiceDecisions {
	const decisions: ChoiceDecisions = new Map();
	for (const conflict of conflicts) {
		decisions.set(conflict.choiceId, conflict.exists ? "overwrite" : "import");
	}
	return decisions;
}

// --- Decision updates (return new Maps) -------------------------------------

export function setChoiceMode(
	decisions: ChoiceDecisions,
	choiceId: string,
	mode: ChoiceImportMode,
): ChoiceDecisions {
	const next = new Map(decisions);
	next.set(choiceId, mode);
	return next;
}

export function setAssetMode(
	decisions: AssetDecisions,
	originalPath: string,
	mode: AssetImportMode,
	exists: ExistsProbe,
): AssetDecisions {
	const previous =
		decisions.get(originalPath) ?? fallbackDecision(originalPath, exists);
	const next = new Map(decisions);
	next.set(originalPath, { ...previous, mode });
	return next;
}

export interface SetAssetPathResult {
	decisions: AssetDecisions;
	/** The path whose existence should be reconciled asynchronously. */
	effectivePath: string;
}

export function setAssetPath(
	decisions: AssetDecisions,
	originalPath: string,
	value: string,
	exists: ExistsProbe,
): SetAssetPathResult {
	const previous =
		decisions.get(originalPath) ?? fallbackDecision(originalPath, exists);
	const trimmed = value.trim();
	const effectivePath = trimmed || originalPath;
	// Preserve the raw (untrimmed) value while editing so the cursor doesn't jump.
	const destinationPath = trimmed ? trimmed : value;
	const destinationExists = exists(effectivePath);
	const next = new Map(decisions);
	next.set(originalPath, {
		...previous,
		mode: reconcileMode(previous.mode, destinationExists),
		destinationPath,
		destinationExists,
	});
	return { decisions: next, effectivePath };
}

/** Apply an authoritative async existence result, correcting the stored mode. */
export function applyExistsResult(
	decisions: AssetDecisions,
	originalPath: string,
	exists: boolean,
): AssetDecisions {
	const current = decisions.get(originalPath);
	if (!current || current.destinationExists === exists) return decisions;
	const next = new Map(decisions);
	next.set(originalPath, {
		...current,
		destinationExists: exists,
		mode: reconcileMode(current.mode, exists),
	});
	return next;
}

// --- Snapshots for applyPackageImport ---------------------------------------

export function snapshotChoiceDecisions(
	conflicts: readonly ChoiceConflict[],
	decisions: ChoiceDecisions,
): ChoiceImportDecision[] {
	return conflicts.map((conflict) => ({
		choiceId: conflict.choiceId,
		mode: effectiveChoiceMode(
			decisions.get(conflict.choiceId) ?? "import",
			conflict.exists,
		),
	}));
}

export function snapshotAssetDecisions(
	conflicts: readonly AssetConflict[],
	decisions: AssetDecisions,
	exists: ExistsProbe,
): AssetImportDecision[] {
	return conflicts.map((conflict) => {
		const decision = decisions.get(conflict.originalPath);
		const destinationPath =
			decision?.destinationPath?.trim() || conflict.originalPath;
		const destinationExists =
			decision?.destinationExists ??
			(conflict.exists || exists(destinationPath));
		const mode = decision?.mode ?? (destinationExists ? "overwrite" : "write");
		return { originalPath: conflict.originalPath, destinationPath, mode };
	});
}

// --- Existence resolver -----------------------------------------------------

/**
 * Resolves whether a destination already exists.
 *
 * - `optimistic` is synchronous and a strict SUBSET of the truth:
 *   getAbstractFileByPath only knows the vault index, so it never
 *   false-positives but misses files under config / dot-folders.
 * - `schedule` reconciles against adapter.exists (which sees everything on
 *   disk) and calls back with the authoritative answer.
 *
 * The per-key token is MONOTONIC for the lifetime of the resolver and is never
 * reset, so a stale in-flight result from a previously-pasted package can never
 * pass the staleness guard and clobber the current package's decision.
 */
export class ExistenceResolver {
	private readonly tokens = new Map<string, number>();

	constructor(private readonly app: App) {}

	optimistic(path: string): boolean {
		const trimmed = path.trim();
		if (!trimmed) return false;
		// Untrusted package paths that escape the vault are never "present".
		if (escapesVaultBoundary(trimmed)) return false;
		return Boolean(
			this.app.vault.getAbstractFileByPath(normalizePath(trimmed)),
		);
	}

	private async resolve(path: string): Promise<boolean> {
		const trimmed = path.trim();
		if (!trimmed) return false;
		// Never stat an out-of-vault path from an untrusted package: a crafted
		// destination like "../../../etc/passwd" must not reach the filesystem.
		if (escapesVaultBoundary(trimmed)) return false;
		try {
			return await this.app.vault.adapter.exists(normalizePath(trimmed));
		} catch {
			return false;
		}
	}

	schedule(
		key: string,
		path: string,
		onResolved: (exists: boolean) => void,
	): void {
		const token = (this.tokens.get(key) ?? 0) + 1;
		this.tokens.set(key, token);
		void this.resolve(path).then((exists) => {
			if (this.tokens.get(key) !== token) return;
			onResolved(exists);
		});
	}
}
