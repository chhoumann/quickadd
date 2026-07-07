import type { App } from "obsidian";
import { normalizePath } from "obsidian";
import { v4 as uuidv4 } from "uuid";
import type IChoice from "../types/choices/IChoice";
import type IMultiChoice from "../types/choices/IMultiChoice";
import type IMacroChoice from "../types/choices/IMacroChoice";
import type ITemplateChoice from "../types/choices/ITemplateChoice";
import type ICaptureChoice from "../types/choices/ICaptureChoice";
import type { QuickAddPackage } from "../types/packages/QuickAddPackage";
import {
	isQuickAddPackage,
	QUICKADD_PACKAGE_SCHEMA_VERSION,
} from "../types/packages/QuickAddPackage";
import { flattenChoices } from "../utils/choiceUtils";
import type { ICommand } from "../types/macros/ICommand";
import type { IChoiceCommand } from "../types/macros/IChoiceCommand";
import type { IConditionalCommand } from "../types/macros/Conditional/IConditionalCommand";
import type { INestedChoiceCommand } from "../types/macros/QuickCommands/INestedChoiceCommand";
import type { IUserScript } from "../types/macros/IUserScript";
import { CommandType } from "../types/macros/CommandType";
import type { AIProvider } from "../ai/Provider";
import { pinAiCommandModelRefs } from "../ai/modelRefPinning";
import { log } from "../logger/logManager";
import { decodeFromBase64 } from "../utils/base64";
import { deepClone } from "../utils/deepClone";
import { ensureParentFolders } from "../utils/ensureParentFolders";
import { assertWriteStaysInVault } from "../utils/vaultWriteGuards";
import { escapesVaultBoundary } from "../utils/vaultPathBoundary";
import {
	detectUserScriptSecretOptions,
	stripUserScriptSecretRefsFromCommand,
} from "../utils/userScriptSecrets";
import type { UserScriptSecretSanitizerOptions } from "../utils/userScriptSecrets";
import {
	buildPackagePreview,
	collectReferencedAssetPaths,
} from "./packagePreview";
import type { PackagePreview } from "./packagePreview";

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
	// Containment guard at the single read entry point, before any filesystem
	// touch. `packagePath` is untrusted (the CLI `path=` flag, the GUI file
	// picker): `normalizePath` collapses slashes but does NOT resolve "..", so a
	// path like "../../../etc/passwd" (or an absolute/drive path) would otherwise
	// reach `adapter.read` and disclose a file OUTSIDE the vault. The sibling
	// analysePackage/analysePackagePreview probes already guard with this; the read
	// path must too, so every current and future caller inherits the protection.
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

export function parseQuickAddPackage(raw: string): QuickAddPackage {
	let parsed: unknown;
	try {
		parsed = JSON.parse(raw);
	} catch (error) {
		throw new Error(
			`Package content is not valid JSON: ${(error as Error)?.message ?? error}`,
		);
	}

	if (!isQuickAddPackage(parsed)) {
		throw new Error("Content is not a valid QuickAdd package.");
	}

	if (parsed.schemaVersion > QUICKADD_PACKAGE_SCHEMA_VERSION) {
		throw new Error(
			`Package schema version ${parsed.schemaVersion} is newer than this plugin supports (${QUICKADD_PACKAGE_SCHEMA_VERSION}).`,
		);
	}

	// Reject duplicate asset paths at the untrusted-input boundary. The writer is
	// last-write-wins per destination while the review pane resolves the FIRST
	// match (decodeAssetPreview), so two assets at one path could show benign bytes
	// in review while malicious bytes land on disk — a silent review-gate desync.
	// Failing closed here keeps reviewed bytes identical to written bytes.
	const duplicateAssetPath = findDuplicateAssetPath(parsed.assets);
	if (duplicateAssetPath !== null) {
		throw new Error(
			`Package contains duplicate asset path "${duplicateAssetPath}". Each asset must have a unique path.`,
		);
	}

	// Reject internally-inconsistent choices at the untrusted-input boundary. The
	// same choice id can appear in MORE than one place in a package: as a flat
	// `pkg.choices` entry AND inline inside a Multi's `choices` array (or as a
	// NestedChoice/Conditional-branch embedded choice). The preview and the writer
	// each pick ONE of those copies and assume the others are identical:
	// buildPackagePreview's walk SKIPS an inline Multi child whose id is also an
	// entry (trusting the entry's walk to cover it), while applyPackageImport's
	// remapChoiceTree INSTALLS the inline copy and drops the standalone entry. A
	// crafted package can make those copies DIVERGE — a benign top-level entry that
	// the preview discloses, paired with a malicious inline child (e.g.
	// runOnStartup:true) that actually installs — suppressing the capability
	// disclosure and acknowledgement gate entirely. The structural validator
	// (isQuickAddPackage) never checks this. A legitimately-exported package always
	// clones every appearance of an id from one source choice, so all appearances
	// are identical; divergence implies tampering. Fail closed so the copy the user
	// reviews is provably the copy that installs.
	const divergentChoiceId = findDivergentChoiceId(parsed.choices);
	if (divergentChoiceId !== null) {
		throw new Error(
			`Package contains conflicting definitions for choice "${divergentChoiceId}". Each choice id must describe the same choice everywhere it appears.`,
		);
	}

	// Reject a parented choice whose declared parent does not actually carry it
	// inline. applyPackageImport installs a child SOLELY through its parent Multi's
	// inline `choices` (remapChoiceTree keeps only the children listed there) and,
	// in the insertion loop, SKIPS the child's own flat entry assuming the parent
	// will carry it. So a hand-edited/cross-version package where entry X names
	// parentChoiceId=M (M an importable entry) while M does not list X inline would
	// import X nowhere — silently dropped while the preview still listed X and the
	// import reports success. A legitimately exported package always inlines a
	// parented child as a direct member of its parent Multi, so failing closed here
	// keeps the previewed set of choices identical to the installed set.
	const uncarriedChildId = findUncarriedChildChoiceId(parsed.choices);
	if (uncarriedChildId !== null) {
		throw new Error(
			`Package choice "${uncarriedChildId}" names a parent that does not list it as a child. Each parented choice must appear inside its parent.`,
		);
	}

	return parsed;
}

function findDuplicateAssetPath(
	assets: QuickAddPackage["assets"],
): string | null {
	const seen = new Set<string>();
	for (const asset of assets) {
		// Key on the normalized destination the writer collides on (so "scripts//x.js"
		// and "scripts/x.js" — distinct strings, one on-disk file — are caught too),
		// not the raw string. normalizePath only collapses slashes/whitespace; it does
		// not resolve "..", so escaping paths still compare honestly (and the write
		// path rejects them regardless).
		const key = normalizePath(asset.originalPath ?? "");
		if (seen.has(key)) return asset.originalPath;
		seen.add(key);
	}
	return null;
}

/**
 * The id of the first choice that appears more than once in the package with
 * DIFFERENT content, or null if every id is internally consistent.
 *
 * Walks every choice node anywhere in the package — flat `pkg.choices` entries
 * plus all descendants reachable via Multi `choices`, Macro-command
 * `NestedChoice` embedded choices, and Conditional then/else branches — keyed by
 * `choice.id`, and compares a canonical serialization of each appearance. The
 * comparison is over the FULL subtree (a divergence deep inside is caught at both
 * the inner id and every enclosing id), key-order-insensitive (so it never
 * false-rejects a re-serialized-but-equal package), and array-order-sensitive (so
 * a reordered command list — which changes behavior — counts as divergent).
 */
function findDivergentChoiceId(
	choices: QuickAddPackage["choices"],
): string | null {
	const canonicalById = new Map<string, string>();
	let divergentId: string | null = null;

	const visit = (choice: IChoice | null | undefined): void => {
		if (divergentId !== null) return;
		if (!choice || typeof choice !== "object") return;

		const id = (choice as { id?: unknown }).id;
		if (typeof id === "string") {
			const canonical = canonicalizeJsonValue(choice);
			const prior = canonicalById.get(id);
			if (prior === undefined) {
				canonicalById.set(id, canonical);
			} else if (prior !== canonical) {
				divergentId = id;
				return;
			}
		}

		if (choice.type === "Multi") {
			const multi = choice as IMultiChoice;
			if (Array.isArray(multi.choices)) {
				for (const child of multi.choices) visit(child);
			}
		}

		if (choice.type === "Macro") {
			const macro = choice as IMacroChoice;
			visitNestedChoicesInCommands(macro.macro?.commands, visit);
		}
	};

	for (const entry of choices) {
		if (divergentId !== null) break;
		visit(entry?.choice);
	}

	return divergentId;
}

function visitNestedChoicesInCommands(
	commands: ICommand[] | undefined,
	visit: (choice: IChoice | null | undefined) => void,
): void {
	if (!Array.isArray(commands)) return;
	for (const command of commands) {
		if (!command) continue;
		if (command.type === CommandType.NestedChoice) {
			visit((command as INestedChoiceCommand).choice);
		} else if (command.type === CommandType.Conditional) {
			const conditional = command as IConditionalCommand;
			visitNestedChoicesInCommands(conditional.thenCommands, visit);
			visitNestedChoicesInCommands(conditional.elseCommands, visit);
		}
	}
}

/**
 * Deterministic, lossless serialization of a JSON value (the parsed package only
 * ever holds JSON primitives, arrays, and plain objects). Object keys are sorted
 * so two appearances that differ only in key order compare equal, while array
 * order is preserved so a reordered list compares unequal. `JSON.parse` exposes a
 * payload `__proto__` as an OWN enumerable property (it does not pollute the
 * prototype), so `Object.keys` includes it and divergence there is still caught.
 */
function canonicalizeJsonValue(value: unknown): string {
	if (value === null || typeof value !== "object") {
		const serialized = JSON.stringify(value);
		// `undefined` (not valid JSON, never produced by JSON.parse) stringifies to
		// the JS value `undefined`; encode it distinctly so it can't collide with a
		// real value.
		return serialized === undefined ? " undefined" : serialized;
	}
	if (Array.isArray(value)) {
		return `[${value.map(canonicalizeJsonValue).join(",")}]`;
	}
	const record = value as Record<string, unknown>;
	const keys = Object.keys(record).sort();
	return `{${keys
		.map((key) => `${JSON.stringify(key)}:${canonicalizeJsonValue(record[key])}`)
		.join(",")}}`;
}

/**
 * The id of the first flat entry whose declared parent is also a package entry but
 * does NOT carry it inline, or null if every parented entry is carried.
 *
 * Mirrors {@link applyPackageImport}'s carry rule EXACTLY: a parented child is
 * installed only as a DIRECT member of its parent Multi's `choices` array (that is
 * the single level {@link remapChoiceTree} keeps and the same level the insertion
 * loop skips the child's own entry for). `parentChoiceId` in any real export is
 * always the direct Multi parent (buildChoiceCatalog only assigns it via Multi
 * recursion; macro/NestedChoice embedded choices are never their own entries), so
 * a direct-membership check neither false-rejects a legitimate package nor
 * false-accepts a child buried under a non-importable grandchild (which the import
 * would still drop). Entries whose `parentChoiceId` is not itself an entry are
 * exempt — the importer routes those to the existing-vault parent or root, so they
 * are never dropped.
 */
function findUncarriedChildChoiceId(
	choices: QuickAddPackage["choices"],
): string | null {
	const entryById = new Map(choices.map((entry) => [entry.choice.id, entry]));

	for (const entry of choices) {
		const parentId = entry.parentChoiceId;
		if (parentId === null) continue;

		const parentEntry = entryById.get(parentId);
		if (!parentEntry) continue;

		const parent = parentEntry.choice;
		const carriedInline =
			parent.type === "Multi" &&
			Array.isArray((parent as IMultiChoice).choices) &&
			(parent as IMultiChoice).choices.some(
				(child) => child?.id === entry.choice.id,
			);
		if (!carriedInline) return entry.choice.id;
	}

	return null;
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

	// Reject a leading-dot config/hidden directory at ANY depth, not just the
	// first segment: "notes/.git/hooks/post-commit" or "docs/.obsidian/plugins/
	// x/main.js" would otherwise pass (segments[0] is "notes"/"docs") yet drop a
	// code-execution payload into a trusted dir on the real filesystem — a vector
	// the realpath guard can't see because the target stays inside the vault. The
	// check is structural (segment starts with "."), so casing variants
	// (.Obsidian) are caught too. The "..%"-prefix carve-out keeps url-encoded
	// traversal text (e.g. "..%2fevil.md") importable as a benign literal filename.
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
	const secretOptionNamesByPath = buildSecretOptionNamesByPath(pkg);
	const importableChoiceIds = new Set<string>();
	const importableCache = new Map<string, boolean>();
	const importableVisiting = new Set<string>();

	const isChoiceImportable = (choiceId: string): boolean => {
		const finalizeImportable = (isImportable: boolean): boolean => {
			importableCache.set(choiceId, isImportable);
			importableVisiting.delete(choiceId);
			return isImportable;
		};

		if (importableCache.has(choiceId)) {
			return importableCache.get(choiceId) as boolean;
		}

		if (importableVisiting.has(choiceId)) {
			// Break potential cycles by treating the current path as importable.
			return true;
		}

		importableVisiting.add(choiceId);

		const decision = choiceDecisionMap.get(choiceId);
		if (decision === "skip") {
			return finalizeImportable(false);
		}

		const entry = catalog.get(choiceId);
		if (!entry) {
			return finalizeImportable(false);
		}

		const parentId = entry.parentChoiceId;
		if (!parentId) {
			return finalizeImportable(true);
		}

		if (!catalog.has(parentId)) {
			return finalizeImportable(true);
		}

		const parentDecision = choiceDecisionMap.get(parentId);
		if (parentDecision === "skip") {
			return finalizeImportable(true);
		}

		const result = isChoiceImportable(parentId);
		return finalizeImportable(result);
	};

	for (const entry of pkg.choices) {
		if (isChoiceImportable(entry.choice.id)) {
			importableChoiceIds.add(entry.choice.id);
		}
	}

	const duplicatedOriginalIds = new Set<string>();
	const nonDuplicatedOriginalIds = new Set<string>();
	const visitingIds = new Set<string>();
	const idMap = new Map<string, string>();

	const isDuplicated = (choiceId: string): boolean => {
		const markDuplicated = (): true => {
			duplicatedOriginalIds.add(choiceId);
			nonDuplicatedOriginalIds.delete(choiceId);
			return true;
		};
		const markNotDuplicated = (): false => {
			nonDuplicatedOriginalIds.add(choiceId);
			return false;
		};

		if (!importableChoiceIds.has(choiceId)) return false;
		const cached = duplicatedOriginalIds.has(choiceId);
		if (cached) return true;
		if (nonDuplicatedOriginalIds.has(choiceId)) return false;
		if (visitingIds.has(choiceId)) return markNotDuplicated();

		visitingIds.add(choiceId);
		try {
			const decision = choiceDecisionMap.get(choiceId);
			if (decision === "duplicate") {
				return markDuplicated();
			}

			const parentId = catalog.get(choiceId)?.parentChoiceId ?? null;
			if (!parentId) return markNotDuplicated();
			const parentDecision = choiceDecisionMap.get(parentId);
			if (parentDecision === "duplicate") {
				return markDuplicated();
			}
			if (!importableChoiceIds.has(parentId)) return markNotDuplicated();
			if (isDuplicated(parentId)) {
				return markDuplicated();
			}

			return markNotDuplicated();
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
			// Parent carries this child inline, so skip its own entry to avoid
			// double-inserting. This trusts the parent to actually list the child
			// inline (remapChoiceTree keeps only direct inline children); a package
			// where it does not is rejected up front by findUncarriedChildChoiceId in
			// parseQuickAddPackage, so a parsed import never silently drops it here.
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
			if (parentByPath) {
				insertIntoMulti(parentByPath, choiceClone);
				addedChoiceIds.push(finalId);
				handledChoices.add(originalId);
				continue;
			}
			log.logWarning(
				`QuickAdd import: could not locate parent for '${entry.choice.name}'. Adding to root.`,
			);
		}

		// Default: append to root
		const existingIndex = updatedChoices.findIndex((c) => c.id === finalId);
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

	// Resolved-destination uniqueness, as a PRE-PASS before any write: two assets
	// can carry DISTINCT originalPaths yet resolve to ONE on-disk destination — the
	// import modal defaults every template/capture asset to
	// `<templateFolder>/<basename>`, so "A/x.md" and "B/x.md" both land at
	// "Templates/x.md". Parse-time dedup keys on originalPath and can't see that.
	// Writing them in sequence is silent last-write-wins: the user reviewed two
	// files but only one set of bytes survives, and a choice rewired to that path
	// (applyAssetPathOverrides) then runs the surviving bytes — breaking the
	// "what you reviewed is what lands" gate. Refuse the whole import instead.
	// Skipped assets never write, so they cannot collide.
	// Fold case ONLY on a case-insensitive vault (macOS/Windows), where
	// "Scripts/x.js" and "scripts/x.js" are ONE physical file. On a case-sensitive
	// vault they are distinct files a legitimate package may ship, so comparing
	// folded would wrongly reject a valid import.
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

	// Symlink/realpath containment, as a PRE-PASS before any write: if a
	// destination resolves through a pre-existing in-vault symlink to outside the
	// vault, abort the whole import before touching disk. Every destination is
	// checked (mirroring the lexical validateAssetDestination pass above), so a
	// package carrying a vault-escaping asset is refused wholesale and surfaced
	// loudly rather than silently dropped — consistent with how an absolute/".."
	// destination already aborts regardless of the per-asset import mode.
	// Desktop-only; a no-op on mobile and in tests (non-FileSystemAdapter).
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

function buildSecretOptionNamesByPath(
	pkg: QuickAddPackage,
): Map<string, ReadonlySet<string> | null> {
	const secretOptionNamesByPath = new Map<string, ReadonlySet<string> | null>();

	for (const asset of pkg.assets) {
		if (asset.kind !== "user-script") continue;

		try {
			const detection = detectUserScriptSecretOptions(
				decodeFromBase64(asset.content),
				asset.originalPath,
			);
			secretOptionNamesByPath.set(
				asset.originalPath,
				detection.foundSecretOptions && detection.names.size === 0
					? null
					: detection.names,
			);
		} catch (error) {
			log.logWarning(
				`QuickAdd import could not inspect user-script settings '${asset.originalPath}': ${
					(error as Error)?.message ?? error
				}`,
			);
		}
	}

	return secretOptionNamesByPath;
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

function remapChoiceTree(
	choice: IChoice,
	idMap: Map<string, string>,
	importableChoiceIds: Set<string>,
	secretSanitizerOptions: UserScriptSecretSanitizerOptions,
): IChoice {
	const originalId = choice.id;
	const finalId = idMap.get(originalId) ?? originalId;
	choice.id = finalId;
	const isDuplicated = finalId !== originalId;

	if (choice.type === "Macro") {
		const macroChoice = choice as IMacroChoice;
		if (isDuplicated) {
			macroChoice.macro.id = uuidv4();
		}
		remapCommands(
			macroChoice.macro.commands,
			idMap,
			importableChoiceIds,
			isDuplicated,
			secretSanitizerOptions,
		);
	}

	if (choice.type === "Multi") {
		const multi = choice as IMultiChoice;
		if (Array.isArray(multi.choices)) {
			multi.choices = multi.choices
				.filter((child) => importableChoiceIds.has(child.id))
				.map((child) =>
					remapChoiceTree(
						child,
						idMap,
						importableChoiceIds,
						secretSanitizerOptions,
					),
				);
		}
	}

	return choice;
}

function remapCommands(
	commands: ICommand[],
	idMap: Map<string, string>,
	importableChoiceIds: Set<string>,
	shouldRegenerateIds: boolean,
	secretSanitizerOptions: UserScriptSecretSanitizerOptions,
): void {
	for (const command of commands) {
		if (!command) continue;
		stripUserScriptSecretRefsFromCommand(command, secretSanitizerOptions);

		if (shouldRegenerateIds) {
			command.id = uuidv4();
		}

		switch (command.type) {
			case CommandType.Choice: {
				const choiceCommand = command as IChoiceCommand;
				const mapped = idMap.get(choiceCommand.choiceId);
				if (mapped) choiceCommand.choiceId = mapped;
				break;
			}
			case CommandType.Conditional: {
				const conditional = command as IConditionalCommand;
				remapCommands(
					conditional.thenCommands,
					idMap,
					importableChoiceIds,
					shouldRegenerateIds,
					secretSanitizerOptions,
				);
				remapCommands(
					conditional.elseCommands,
					idMap,
					importableChoiceIds,
					shouldRegenerateIds,
					secretSanitizerOptions,
				);
				break;
			}
		case CommandType.NestedChoice: {
			const nested = command as INestedChoiceCommand;
			if (nested.choice && importableChoiceIds.has(nested.choice.id)) {
				nested.choice = remapChoiceTree(
					nested.choice,
					idMap,
					importableChoiceIds,
					secretSanitizerOptions,
				);
			}
			break;
		}
			default:
				break;
		}
	}
}

function replaceChoiceInTree(choices: IChoice[], replacement: IChoice): boolean {
	for (let i = 0; i < choices.length; i++) {
		const current = choices[i];
		if (current.id === replacement.id) {
			choices.splice(i, 1, replacement);
			return true;
		}
		if (current.type === "Multi") {
			const multi = current as IMultiChoice;
			if (multi.choices && replaceChoiceInTree(multi.choices, replacement)) {
				return true;
			}
		}
	}
	return false;
}

function insertUnderParent(
	choices: IChoice[],
	parentId: string,
	child: IChoice,
): boolean {
	for (const choice of choices) {
		if (choice.id === parentId && choice.type === "Multi") {
			insertIntoMulti(choice as IMultiChoice, child);
			return true;
		}
		if (choice.type === "Multi") {
			const multi = choice as IMultiChoice;
			if (multi.choices && insertUnderParent(multi.choices, parentId, child)) {
				return true;
			}
		}
	}
	return false;
}

function insertIntoMulti(parent: IMultiChoice, child: IChoice): void {
	if (!Array.isArray(parent.choices)) {
		parent.choices = [];
	}
	const idx = parent.choices.findIndex((choice) => choice.id === child.id);
	if (idx !== -1) {
		parent.choices.splice(idx, 1, child);
	} else {
		parent.choices.push(child);
	}
}

function findMultiByPath(
	rootChoices: IChoice[],
	path: string[],
): IMultiChoice | null {
	if (path.length === 0) return null;
	let currentChoices = rootChoices;
	let currentMulti: IMultiChoice | null = null;

	for (const segment of path) {
		const next = currentChoices.find(
			(choice) => choice.type === "Multi" && choice.name === segment,
		) as IMultiChoice | undefined;
		if (!next) return null;
		currentMulti = next;
		currentChoices = next.choices ?? [];
	}

	return currentMulti;
}

function applyAssetPathOverrides(
	choice: IChoice,
	pathOverrides: Map<string, string>,
): void {
	switch (choice.type) {
		case "Macro": {
			const macroChoice = choice as IMacroChoice;
			applyOverridesToCommands(macroChoice.macro.commands, pathOverrides);
			break;
		}
		case "Template": {
			const templateChoice = choice as ITemplateChoice;
			const replacement = pathOverrides.get(templateChoice.templatePath);
			if (replacement) {
				templateChoice.templatePath = replacement;
			}
			break;
		}
		case "Capture": {
			const captureChoice = choice as ICaptureChoice;
			const templatePath = captureChoice.createFileIfItDoesntExist?.template;
			if (templatePath) {
				const replacement = pathOverrides.get(templatePath);
				if (replacement) {
					captureChoice.createFileIfItDoesntExist = {
						...captureChoice.createFileIfItDoesntExist,
						template: replacement,
					};
				}
			}
			break;
		}
		case "Multi": {
			const multi = choice as IMultiChoice;
			multi.choices?.forEach((child) =>
				applyAssetPathOverrides(child, pathOverrides),
			);
			break;
		}
		default:
			break;
	}
}

function applyOverridesToCommands(
	commands: ICommand[],
	pathOverrides: Map<string, string>,
): void {
	for (const command of commands) {
		if (!command) continue;

		switch (command.type) {
			case CommandType.UserScript: {
				const userScript = command as IUserScript;
				const replacement = pathOverrides.get(userScript.path);
				if (replacement) {
					// Note-backed scripts use the vault path as their command name
					// (and member selector, `path::member`); keep it in sync when the
					// asset is written to a different destination on import. `.js`
					// scripts use a basename name (!= path), so this leaves them alone.
					if (userScript.name === userScript.path) {
						userScript.name = replacement;
					} else if (userScript.name.startsWith(`${userScript.path}::`)) {
						userScript.name =
							replacement + userScript.name.slice(userScript.path.length);
					}
					userScript.path = replacement;
				}
				break;
			}
			case CommandType.Conditional: {
				const conditional = command as IConditionalCommand;
				if (
					conditional.condition.mode === "script" &&
					conditional.condition.scriptPath
				) {
					const replacement = pathOverrides.get(
						conditional.condition.scriptPath,
					);
					if (replacement) {
						conditional.condition = {
							...conditional.condition,
							scriptPath: replacement,
						};
					}
				}

				applyOverridesToCommands(conditional.thenCommands, pathOverrides);
				applyOverridesToCommands(conditional.elseCommands, pathOverrides);
				break;
			}
			case CommandType.NestedChoice: {
				const nested = command as INestedChoiceCommand;
				if (nested.choice) {
					applyAssetPathOverrides(nested.choice, pathOverrides);
				}
				break;
			}
			default:
				break;
		}
	}
}
