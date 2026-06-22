import type { App } from "obsidian";
import { normalizePath } from "obsidian";
import type IChoice from "../types/choices/IChoice";
import type IMultiChoice from "../types/choices/IMultiChoice";
import type {
	QuickAddPackage,
	QuickAddPackageAsset,
	QuickAddPackageChoice,
	QuickAddPackageAssetKind,
} from "../types/packages/QuickAddPackage";
import { QUICKADD_PACKAGE_SCHEMA_VERSION } from "../types/packages/QuickAddPackage";
import {
	collectChoiceClosure,
	collectScriptDependencies,
	collectFileDependencies,
} from "../utils/packageTraversal";
import { log } from "../logger/logManager";
import GenericYesNoPrompt from "../gui/GenericYesNoPrompt/GenericYesNoPrompt";
import { decodeFromBase64, encodeToBase64 } from "../utils/base64";
import { deepClone } from "../utils/deepClone";
import { ensureParentFolders } from "../utils/ensureParentFolders";
import {
	detectUserScriptSecretOptions,
	stripUserScriptSecretRefsFromChoice,
} from "../utils/userScriptSecrets";

export interface BuildPackageOptions {
	choices: IChoice[];
	rootChoiceIds: readonly string[];
	quickAddVersion: string;
	createdAt?: string;
	excludedChoiceIds?: readonly string[];
}

export interface BuildPackageResult {
	pkg: QuickAddPackage;
	missingChoiceIds: string[];
	missingAssets: MissingAsset[];
}

export interface MissingAsset {
	path: string;
	kind: QuickAddPackageAssetKind;
}

export function generateDefaultPackagePath(): string {
	const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
	return `QuickAdd Packages/quickadd-package-${timestamp}.quickadd.json`;
}

export async function buildPackage(
	app: App,
	options: BuildPackageOptions,
): Promise<BuildPackageResult> {
	const { choices, rootChoiceIds, quickAddVersion } = options;
	const excludedIds = new Set(options.excludedChoiceIds ?? []);
	const createdAt = options.createdAt ?? new Date().toISOString();

	const closure = collectChoiceClosure(choices, rootChoiceIds, {
		excludedChoiceIds: excludedIds,
	});
	const includedChoiceIds = new Set(closure.choiceIds);
	const scripts = collectScriptDependencies(closure.catalog, closure.choiceIds);
	const files = collectFileDependencies(closure.catalog, closure.choiceIds);

	const assetDescriptors = collectAssetDescriptors(scripts, files);

	const assets = await encodeAssets(app, assetDescriptors);
	const secretOptionNamesByPath = buildSecretOptionNamesByPath(
		assets.encodedAssets,
	);

	const packageChoices: QuickAddPackageChoice[] = closure.choiceIds.map(
			(choiceId) => {
				const entry = closure.catalog.get(choiceId);
				if (!entry) throw new Error(`Choice '${choiceId}' missing from catalog.`);
				const clonedChoice = deepClone(entry.choice);
				pruneChoiceTree(clonedChoice, includedChoiceIds);
				stripUserScriptSecretRefsFromChoice(clonedChoice, {
					secretOptionNamesByPath,
					stripUnknownStringSettings: true,
				});
				return {
					choice: clonedChoice,
					pathHint: [...entry.path],
					parentChoiceId: entry.parentId,
			};
		},
	);

	const normalizedRootIds = rootChoiceIds.filter((id) =>
		includedChoiceIds.has(id),
	);

	const pkg: QuickAddPackage = {
		schemaVersion: QUICKADD_PACKAGE_SCHEMA_VERSION,
		quickAddVersion,
		createdAt,
		rootChoiceIds: [...normalizedRootIds],
		choices: packageChoices,
		assets: assets.encodedAssets,
	};

	return {
		pkg,
		missingChoiceIds: closure.missingChoiceIds,
		missingAssets: assets.missingAssets,
	};
}

interface AssetDescriptor {
	path: string;
	kind: QuickAddPackageAssetKind;
}

interface EncodedAssets {
	encodedAssets: QuickAddPackageAsset[];
	missingAssets: MissingAsset[];
}

function collectAssetDescriptors(
	scripts: ReturnType<typeof collectScriptDependencies>,
	files: ReturnType<typeof collectFileDependencies>,
): AssetDescriptor[] {
	const descriptors = new Map<string, QuickAddPackageAssetKind>();

	for (const path of scripts.userScriptPaths) {
		if (path) descriptors.set(path, "user-script");
	}

	for (const path of scripts.conditionalScriptPaths) {
		if (!path) continue;
		descriptors.set(path, "conditional-script");
	}

	for (const path of files.templatePaths) {
		if (!path) continue;
		if (!descriptors.has(path)) descriptors.set(path, "template");
	}

	for (const path of files.captureTemplatePaths) {
		if (!path) continue;
		if (!descriptors.has(path)) descriptors.set(path, "capture-template");
	}

	return Array.from(descriptors.entries()).map(([path, kind]) => ({
		path,
		kind,
	}));
}

async function encodeAssets(
	app: App,
	descriptors: AssetDescriptor[],
): Promise<EncodedAssets> {
	const encodedAssets: QuickAddPackageAsset[] = [];
	const missingAssets: MissingAsset[] = [];

	for (const { path, kind } of descriptors) {
		try {
			const exists = await app.vault.adapter.exists(path);
			if (!exists) {
				missingAssets.push({ path, kind });
				log.logWarning(`QuickAdd export skipped missing ${kind}: ${path}`);
				continue;
			}

			const content = await app.vault.adapter.read(path);

			encodedAssets.push({
				kind,
				originalPath: path,
				contentEncoding: "base64",
				content: encodeToBase64(content),
			});
		} catch (error) {
			missingAssets.push({ path, kind });
			log.logWarning(
				`QuickAdd export failed to read ${kind} '${path}': ${
					(error as Error)?.message ?? error
				}`,
			);
		}
	}

	return { encodedAssets, missingAssets };
}

function buildSecretOptionNamesByPath(
	assets: QuickAddPackageAsset[],
): Map<string, ReadonlySet<string> | null> {
	const secretOptionNamesByPath = new Map<string, ReadonlySet<string> | null>();

	for (const asset of assets) {
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
				`QuickAdd export could not inspect user-script settings '${asset.originalPath}': ${
					(error as Error)?.message ?? error
				}`,
			);
		}
	}

	return secretOptionNamesByPath;
}

function pruneChoiceTree(
	choice: IChoice,
	includedIds: ReadonlySet<string>,
): void {
	if (choice.type !== "Multi") {
		return;
	}

	const multi = choice as IMultiChoice;
	if (!Array.isArray(multi.choices) || multi.choices.length === 0) {
		multi.choices = [];
		return;
	}

	multi.choices = multi.choices
		.filter((child) => includedIds.has(child.id))
		.map((child) => {
			pruneChoiceTree(child, includedIds);
			return child;
		});
}

export interface WritePackageOptions {
	/**
	 * Invoked when the target path already exists, so the caller can confirm the
	 * overwrite before any data is replaced. Returning false aborts the write
	 * (writePackageToVault throws so the caller can report a clean cancellation).
	 * Defaults to a Yes/No prompt. Injectable for tests / non-interactive callers.
	 */
	confirmOverwrite?: (normalizedPath: string) => Promise<boolean>;
}

export interface WritePackageResult {
	overwritten: boolean;
}

async function defaultConfirmOverwrite(
	app: App,
	normalizedPath: string,
): Promise<boolean> {
	try {
		return await GenericYesNoPrompt.Prompt(
			app,
			"Overwrite existing file?",
			`A file already exists at '${normalizedPath}'. Saving the package will overwrite it. Continue?`,
		);
	} catch {
		// Dismissing the prompt (Esc) is treated as "do not overwrite".
		return false;
	}
}

export async function writePackageToVault(
	app: App,
	pkg: QuickAddPackage,
	outputPath: string,
	options: WritePackageOptions = {},
): Promise<WritePackageResult> {
	const normalizedPath = normalizePath(outputPath.trim());
	if (!normalizedPath) {
		throw new Error("Output path cannot be empty.");
	}

	const overwriting = await app.vault.adapter.exists(normalizedPath);
	if (overwriting) {
		const confirm =
			options.confirmOverwrite ??
			((path: string) => defaultConfirmOverwrite(app, path));
		const confirmed = await confirm(normalizedPath);
		if (!confirmed) {
			throw new Error(`Save cancelled: '${normalizedPath}' already exists.`);
		}
	}

	await ensureParentFolders(app, normalizedPath);
	const serialized = JSON.stringify(pkg, null, 2);
	await app.vault.adapter.write(normalizedPath, serialized);

	return { overwritten: overwriting };
}
