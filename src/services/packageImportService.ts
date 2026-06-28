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

	return parsed;
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
			: await assetExists(app, asset.originalPath);
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
			// Parent will be handled separately; avoid double-inserting children.
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

	// Symlink/realpath containment, as a PRE-PASS before any write so the import
	// is all-or-nothing (matching the lexical validation above): if a destination
	// resolves through a pre-existing in-vault symlink to outside the vault, abort
	// before touching disk rather than after partially writing earlier assets.
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
