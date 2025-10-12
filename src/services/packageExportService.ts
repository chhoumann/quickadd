import type { App } from "obsidian";
import { normalizePath } from "obsidian";
import type IChoice from "../types/choices/IChoice";
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
import { encodeToBase64 } from "../utils/base64";

export interface BuildPackageOptions {
	choices: IChoice[];
	rootChoiceIds: readonly string[];
	quickAddVersion: string;
	createdAt?: string;
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
	const createdAt = options.createdAt ?? new Date().toISOString();

	const closure = collectChoiceClosure(choices, rootChoiceIds);
	const scripts = collectScriptDependencies(closure.catalog, closure.choiceIds);
	const files = collectFileDependencies(closure.catalog, closure.choiceIds);

	const assetDescriptors = collectAssetDescriptors(scripts, files);

	const assets = await encodeAssets(app, assetDescriptors);

	const packageChoices: QuickAddPackageChoice[] = closure.choiceIds.map(
		(choiceId) => {
			const entry = closure.catalog.get(choiceId);
			if (!entry) throw new Error(`Choice '${choiceId}' missing from catalog.`);
			return {
				choice: structuredClone(entry.choice),
				pathHint: [...entry.path],
				parentChoiceId: entry.parentId,
			};
		},
	);

	const pkg: QuickAddPackage = {
		schemaVersion: QUICKADD_PACKAGE_SCHEMA_VERSION,
		quickAddVersion,
		createdAt,
		rootChoiceIds: [...rootChoiceIds],
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

export async function writePackageToVault(
	app: App,
	pkg: QuickAddPackage,
	outputPath: string,
): Promise<void> {
	const normalizedPath = normalizePath(outputPath.trim());
	if (!normalizedPath) {
		throw new Error("Output path cannot be empty.");
	}

	await ensureParentFolders(app, normalizedPath);
	const serialized = JSON.stringify(pkg, null, 2);
	await app.vault.adapter.write(normalizedPath, serialized);
}

async function ensureParentFolders(app: App, filePath: string): Promise<void> {
	const lastSlash = filePath.lastIndexOf("/");
	if (lastSlash < 0) return;

	const folderPath = filePath.slice(0, lastSlash);
	if (!folderPath) return;

	const segments = folderPath.split("/").filter(Boolean);
	let current = "";

	for (const segment of segments) {
		current = current ? `${current}/${segment}` : segment;
		const exists = await app.vault.adapter.exists(current);
		if (!exists) {
			await app.vault.createFolder(current);
		}
	}
}
