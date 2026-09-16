import type { App } from "obsidian";
import { normalizePath } from "obsidian";
import { v4 as uuidv4 } from "uuid";
import type { AIProvider } from "../ai/Provider";
import { pinAiCommandModelRefs } from "../ai/modelRefPinning";
import { log } from "../logger/logManager";
import type IChoice from "../types/choices/IChoice";
import type { QuickAddPackage } from "../types/packages/QuickAddPackage";
import { decodeFromBase64 } from "../utils/base64";
import {
	flattenChoices,
	isChoiceLike
} from "../utils/choiceUtils";
import { deepClone } from "../utils/deepClone";
import { ensureParentFolders } from "../utils/ensureParentFolders";
import { escapesVaultBoundary } from "../utils/vaultPathBoundary";
import { assertWriteStaysInVault } from "../utils/vaultWriteGuards";
import { packageSecretOptionNames } from "./packageAssets";
import { applyAssetPathOverrides, findMultiByPath, insertIntoMulti, insertUnderParent, remapChoiceTree, replaceChoiceInTree } from "./packageChoiceImport";
import type { PackagePreview } from "./packagePreview";
import {
	buildPackagePreview,
	collectReferencedAssetPaths,
} from "./packagePreview";
import { parseQuickAddPackage } from "./packageValidation";
export { parseQuickAddPackage } from "./packageValidation";

export interface LoadedQuickAddPackage {
	pkg: QuickAddPackage;
	path: string;
}

export interface ChoiceConflict {
	choiceId: string;
	name: string;
	parentChoiceId: string | null;
	pathHint: string[];
	exists: boolean;
}

export interface AssetConflict {
	originalPath: string;
	exists: boolean;
	kind: QuickAddPackage["assets"][number]["kind"];
}

export interface PackageAnalysis {
	choiceConflicts: ChoiceConflict[];
	assetConflicts: AssetConflict[];
}

export type ChoiceImportMode = "import" | "overwrite" | "duplicate" | "skip";
export type AssetImportMode = "write" | "overwrite" | "skip";

export interface ChoiceImportDecision {
	choiceId: string;
	mode: ChoiceImportMode;
}

export interface AssetImportDecision {
	originalPath: string;
	destinationPath: string;
	mode: AssetImportMode;
}

export interface ApplyImportOptions {
	app: App;
	existingChoices: IChoice[];
	pkg: QuickAddPackage;
	choiceDecisions: ChoiceImportDecision[];
	assetDecisions: AssetImportDecision[];
	/**
	 * The vault's configured AI providers. When given, imported AI commands
	 * carrying only a bare model name are pinned to the provider that name
	 * first-match resolves to at import time (#1495) — the one-time migration
	 * has already run by then and would never see them. Optional so callers
	 * without provider context (tests) import unchanged.
	 */
	aiProviders?: AIProvider[];
}

export interface ApplyImportResult {
	updatedChoices: IChoice[];
	addedChoiceIds: string[];
	overwrittenChoiceIds: string[];
	skippedChoiceIds: string[];
	writtenAssets: string[];
	skippedAssets: string[];
}

export async function readQuickAddPackage(
	app: App,
	packagePath: string,
): Promise<LoadedQuickAddPackage> {
	// Reject escaping input before touching the filesystem. normalizePath does not resolve "..".
	if (escapesVaultBoundary(packagePath)) {
		throw new Error(
			`Refusing to read a package outside the vault: "${packagePath}".`,
		);
	}

	const normalized = normalizePath(packagePath.trim());
	if (!normalized) throw new Error("Package path cannot be empty.");

	const exists = await app.vault.adapter.exists(normalized);
	if (!exists) throw new Error(`Package file not found: ${normalized}`);

	const raw = await app.vault.adapter.read(normalized);
	const parsed = parseQuickAddPackage(raw);

	return {
		pkg: parsed,
		path: normalized,
	};
}

export async function analysePackage(
	app: App,
	existingChoices: IChoice[],
	pkg: QuickAddPackage,
): Promise<PackageAnalysis> {
	const existingById = new Map(
		flattenChoices(existingChoices).map((choice) => [choice.id, choice]),
	);

	const choiceConflicts: ChoiceConflict[] = pkg.choices.map((entry) => ({
		choiceId: entry.choice.id,
		name: entry.choice.name,
		parentChoiceId: entry.parentChoiceId,
		pathHint: entry.pathHint ?? [],
		exists: existingById.has(entry.choice.id),
	}));

	const assetConflicts: AssetConflict[] = [];
	for (const asset of pkg.assets) {
		// Never stat an out-of-vault path from an untrusted package: a crafted
		// originalPath like "../../../etc/passwd" must not reach the filesystem.
		// Treat it as not-present (the write path rejects it anyway).
		const exists = escapesVaultBoundary(asset.originalPath)
			? false
			: await app.vault.adapter.exists(asset.originalPath);
		assetConflicts.push({
			originalPath: asset.originalPath,
			exists,
			kind: asset.kind,
		});
	}

	return { choiceConflicts, assetConflicts };
}

/**
 * Build the rich import-preview model: every file added/overwritten, readable
 * script contents (decoded lazily by the UI), and the package's dangerous
 * capabilities. Additive over {@link analysePackage} — it owns the single vault
 * touch needed to resolve which referenced paths already exist, then delegates
 * to the pure {@link buildPackagePreview}.
 */
export async function analysePackagePreview(
	app: App,
	existingChoices: IChoice[],
	pkg: QuickAddPackage,
): Promise<PackagePreview> {
	const candidatePaths = new Set<string>([
		...pkg.assets.map((asset) => asset.originalPath),
		...collectReferencedAssetPaths(pkg),
	]);

	// Probe paths concurrently: latency is one disk round-trip, not N. Set.add
	// from parallel microtasks is safe on JS's single thread.
	const existsByPath = new Set<string>();
	await Promise.all(
		Array.from(candidatePaths, async (path) => {
			if (!path) return;
			// Out-of-vault paths from an untrusted package never reach the
			// filesystem; leaving them out of existsByPath surfaces them honestly
			// as missing/orphan references in the preview instead of stat-probing
			// (and possibly mislabeling an outside file as "present").
			if (escapesVaultBoundary(path)) return;
			if (await assetExists(app, path)) existsByPath.add(path);
		}),
	);

	const preview = buildPackagePreview(existingChoices, pkg, existsByPath);

	const { summary } = preview;
	log.logMessage(
		`QuickAdd import preview: choices=${preview.choiceCount} files=${preview.fileCount} ` +
		`scripts=${summary.scriptCount} runOnStartup=${summary.runsOnStartup} ` +
		`registersCommands=${summary.registersCommandCount} ` +
		`overwritesChoices=${summary.overwritesChoices} overwritesFiles=${summary.overwritesFiles} ` +
		`missing=${summary.missingCount} critical=${summary.criticalCount} warning=${summary.warningCount}`,
	);

	return preview;
}

/**
 * Validate that an imported asset's destination stays inside the vault and does
 * not target a dotfile config directory (.obsidian, .git, ...). Throws on any
 * out-of-bounds destination so the whole import aborts (surfaced as a Notice by
 * ImportPackageModal). Defensive: imported packages are untrusted shared data.
 */
function validateAssetDestination(rawPath: string): string {
	const rawDestination = rawPath ?? "";
	const trimmedDestination = rawDestination.trim();
	if (!trimmedDestination) {
		throw new Error("Package asset has an empty destination path.");
	}

	const slashNormalizedRawDestination = trimmedDestination.replace(/\\/g, "/");
	if (
		slashNormalizedRawDestination.startsWith("/") ||
		/^[a-zA-Z]:/.test(slashNormalizedRawDestination)
	) {
		throw new Error(
			`Refusing to import asset to an absolute path outside the vault: "${slashNormalizedRawDestination}".`,
		);
	}

	const normalized = normalizePath(trimmedDestination);
	if (!normalized || normalized.trim() === "") {
		throw new Error("Package asset has an empty destination path.");
	}

	const segments = normalized.split("/").filter((segment) => segment.length > 0);
	if (segments.some((segment) => segment === "..")) {
		throw new Error(
			`Refusing to import asset with a path-traversal segment ("..") in: "${normalized}".`,
		);
	}

	// Reject hidden/config segments at every depth; "..%" remains a literal filename.
	const configSegment = segments.find(
		(segment) => segment.startsWith(".") && !segment.startsWith("..%"),
	);
	if (configSegment) {
		throw new Error(
			`Refusing to import asset into a config directory: "${normalized}".`,
		);
	}

	return normalized;
}

export async function applyPackageImport(
	options: ApplyImportOptions,
): Promise<ApplyImportResult> {
	const { app, existingChoices, pkg } = options;
	const choiceDecisionMap: Map<string, ChoiceImportMode> = new Map(
		options.choiceDecisions.map((decision) => [decision.choiceId, decision.mode]),
	);
	const assetDecisionMap: Map<string, AssetImportDecision> = new Map(
		options.assetDecisions.map((decision) => [decision.originalPath, decision]),
	);

	const catalog = new Map(pkg.choices.map((entry) => [entry.choice.id, entry]));
	const secretOptionNamesByPath = packageSecretOptionNames(pkg.assets, "import");
	// Children of skipped or external parents are still imported independently.
	const importableChoiceIds = new Set(
		pkg.choices
			.filter((entry) => choiceDecisionMap.get(entry.choice.id) !== "skip")
			.map((entry) => entry.choice.id),
	);

	const duplicationById = new Map<string, boolean>();
	const visitingIds = new Set<string>();
	const idMap = new Map<string, string>();

	const isDuplicated = (choiceId: string): boolean => {
		if (!importableChoiceIds.has(choiceId)) return false;
		const cached = duplicationById.get(choiceId);
		if (cached !== undefined) return cached;
		if (visitingIds.has(choiceId)) {
			duplicationById.set(choiceId, false);
			return false;
		}
		visitingIds.add(choiceId);
		try {
			const parentId = catalog.get(choiceId)?.parentChoiceId;
			const duplicated = choiceDecisionMap.get(choiceId) === "duplicate" || Boolean(
				parentId && (
					choiceDecisionMap.get(parentId) === "duplicate" ||
					(importableChoiceIds.has(parentId) && isDuplicated(parentId))
				),
			);
			duplicationById.set(choiceId, duplicated);
			return duplicated;
		} finally {
			visitingIds.delete(choiceId);
		}
	};

	for (const entry of pkg.choices) {
		if (!importableChoiceIds.has(entry.choice.id)) continue;
		const shouldDuplicate = isDuplicated(entry.choice.id);
		const newId = shouldDuplicate ? uuidv4() : entry.choice.id;
		idMap.set(entry.choice.id, newId);
	}

	const updatedChoices = deepClone(existingChoices);
	const addedChoiceIds: string[] = [];
	const overwrittenChoiceIds: string[] = [];
	const skippedChoiceIds: string[] = [];

	// Prepare cloned choices with remapped IDs
	const preparedChoices = new Map<string, IChoice>();
	for (const entry of pkg.choices) {
		if (!importableChoiceIds.has(entry.choice.id)) {
			skippedChoiceIds.push(entry.choice.id);
			continue;
		}

		const clone = deepClone(entry.choice);
		const remapped = remapChoiceTree(
			clone,
			idMap,
			importableChoiceIds,
			{
				secretOptionNamesByPath,
				stripUnknownStringSettings: true,
			},
		);
		preparedChoices.set(entry.choice.id, remapped);
	}

	// Pin imported bare-name AI commands before insertion: cross-vault refs
	// that survived export are kept when still valid; everything else adopts
	// this vault's current first-match provider, so a later provider add or
	// reorder can't silently reroute the imported command.
	if (options.aiProviders?.length) {
		pinAiCommandModelRefs(
			Array.from(preparedChoices.values()),
			options.aiProviders,
		);
	}

	const handledChoices = new Set<string>();

	for (const entry of pkg.choices) {
		const originalId = entry.choice.id;
		if (!importableChoiceIds.has(originalId)) continue;
		if (handledChoices.has(originalId)) continue;

		const choiceClone = preparedChoices.get(originalId);
		if (!choiceClone) continue;

		const finalId = choiceClone.id;
		const decision = choiceDecisionMap.get(originalId) ?? "import";

		const parentId = entry.parentChoiceId;
		const parentImported =
			parentId && importableChoiceIds.has(parentId)
				? preparedChoices.get(parentId)
				: null;

		if (parentImported) {
			// The parsed parent carries this child inline; inserting its flat entry would duplicate it.
			// packageValidation rejects parents that omit their declared children.
			handledChoices.add(originalId);
			continue;
		}

		if (decision === "overwrite" || decision === "import") {
			const replaced = replaceChoiceInTree(updatedChoices, choiceClone);
			if (replaced) {
				overwrittenChoiceIds.push(finalId);
				handledChoices.add(originalId);
				continue;
			}
		}

		if (parentId) {
			const resolvedParentId = idMap.get(parentId) ?? parentId;
			const insertedUnderParent = insertUnderParent(
				updatedChoices,
				resolvedParentId,
				choiceClone,
			);
			if (insertedUnderParent) {
				addedChoiceIds.push(finalId);
				handledChoices.add(originalId);
				continue;
			}
			const parentByPath = findMultiByPath(
				updatedChoices,
				entry.pathHint.slice(0, -1),
			);
			if (parentByPath && insertIntoMulti(parentByPath, choiceClone)) {
				addedChoiceIds.push(finalId);
				handledChoices.add(originalId);
				continue;
			}
			log.logWarning(
				`QuickAdd import: could not locate parent for '${entry.choice.name}'. Adding to root.`,
			);
		}

		// Default: append to root
		const existingIndex = updatedChoices.findIndex(
			(c) => isChoiceLike(c) && c.id === finalId,
		);
		if (existingIndex !== -1) {
			updatedChoices.splice(existingIndex, 1, choiceClone);
			overwrittenChoiceIds.push(finalId);
		} else {
			updatedChoices.push(choiceClone);
			addedChoiceIds.push(finalId);
		}

		handledChoices.add(originalId);
	}

	const assetPathOverrides = new Map<string, string>();
	const writtenAssets: string[] = [];
	const skippedAssets: string[] = [];
	const resolvedAssetDestinations = pkg.assets.map((asset) => {
		const decision = assetDecisionMap.get(asset.originalPath);
		const destinationPathInput = decision?.destinationPath?.trim();
		const destinationPath = validateAssetDestination(
			destinationPathInput || asset.originalPath,
		);
		return { asset, destinationPath };
	});

	// Validate all resolved destinations before writes so reviewed bytes cannot be replaced by a collision.
	// Skipped assets cannot collide. Fold case only on case-insensitive vaults.
	const foldCase = await isVaultCaseInsensitive(app);
	const destinationOwners = new Map<
		string,
		{ originalPath: string; destinationPath: string }
	>();
	for (const { asset, destinationPath } of resolvedAssetDestinations) {
		if (assetDecisionMap.get(asset.originalPath)?.mode === "skip") continue;
		const key = foldCase ? destinationPath.toLowerCase() : destinationPath;
		const prior = destinationOwners.get(key);
		if (prior) {
			throw new Error(
				`Refusing to import: assets "${prior.originalPath}" and "${asset.originalPath}" resolve to the same destination ("${destinationPath}"). Rename one so each imported file is unique.`,
			);
		}
		destinationOwners.set(key, {
			originalPath: asset.originalPath,
			destinationPath,
		});
	}

	// Check every destination, including skipped assets, before any write.
	// Lexically safe paths can still escape through an existing symlink.
	for (const { destinationPath } of resolvedAssetDestinations) {
		await assertWriteStaysInVault(app, destinationPath);
	}

	for (const { asset, destinationPath } of resolvedAssetDestinations) {
		const decision = assetDecisionMap.get(asset.originalPath);
		const exists = await assetExists(app, destinationPath);
		const mode =
			decision?.mode ?? (exists ? "overwrite" : "write");

		if (mode === "skip") {
			skippedAssets.push(destinationPath);
			continue;
		}

		await ensureParentFolders(app, destinationPath);
		const content = decodeFromBase64(asset.content);
		await app.vault.adapter.write(destinationPath, content);
		writtenAssets.push(destinationPath);
		assetPathOverrides.set(asset.originalPath, destinationPath);
	}

	for (const choice of preparedChoices.values()) {
		applyAssetPathOverrides(choice, assetPathOverrides);
	}

	return {
		updatedChoices,
		addedChoiceIds,
		overwrittenChoiceIds,
		skippedChoiceIds,
		writtenAssets,
		skippedAssets,
	};
}


async function assetExists(app: App, path: string): Promise<boolean> {
	try {
		return await app.vault.adapter.exists(path);
	} catch {
		return false;
	}
}

/**
 * Probe whether the vault filesystem is case-insensitive (macOS/Windows). A
 * case-swapped variant of the always-present config dir resolves to the same
 * entry only when the filesystem ignores case. Used to decide whether two
 * destination paths that differ only by case denote one physical file.
 */
async function isVaultCaseInsensitive(app: App): Promise<boolean> {
	const configDir = app.vault.configDir;
	if (!configDir) return false;
	const swapped =
		configDir === configDir.toLowerCase()
			? configDir.toUpperCase()
			: configDir.toLowerCase();
	if (swapped === configDir) return false;
	try {
		return await app.vault.adapter.exists(swapped);
	} catch {
		return false;
	}
}
