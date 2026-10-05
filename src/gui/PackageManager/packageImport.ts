import type { App } from "obsidian";
import { settingsStore } from "../../settingsStore";
import type IChoice from "../../types/choices/IChoice";
import type { QuickAddPackage } from "../../types/packages/QuickAddPackage";
import type {
	ApplyImportResult,
	AssetImportDecision,
	ChoiceImportDecision,
	PackageAnalysis,
} from "../../services/packageImportService";
import {
	analysePackage,
	analysePackagePreview,
	applyPackageImport,
} from "../../services/packageImportService";
import type { PackagePreview } from "../../services/packagePreview";
import { requiresAcknowledgement } from "../../services/packagePreview";
import { type AssetConflict, defaultAssetDestinationFor } from "./importDecisions";

/**
 * The import path every package takes in the app, pasted or picked from the
 * Recipes gallery: analysis against the current choices, then the import
 * itself, which replaces the stored choices.
 */

export async function analyseForImport(
	app: App,
	pkg: QuickAddPackage,
): Promise<{ analysis: PackageAnalysis; preview: PackagePreview }> {
	const existingChoices = settingsStore.getState().choices;
	const [analysis, preview] = await Promise.all([
		analysePackage(app, existingChoices, pkg),
		analysePackagePreview(app, existingChoices, pkg),
	]);
	return { analysis, preview };
}

/** Where a bundled file lands unless the user edits the path. */
export function defaultAssetDestination(conflict: AssetConflict): string {
	return defaultAssetDestinationFor(conflict, settingsStore.getState().templateFolderPaths);
}

/**
 * The decisions for a package that needs no review: nothing it adds exists
 * yet and nothing in it can run code. Null when the review has something to
 * ask, so the caller shows it.
 */
export async function decisionsWithoutReview(
	app: App,
	analysis: PackageAnalysis,
	preview: PackagePreview,
): Promise<{ choiceDecisions: ChoiceImportDecision[]; assetDecisions: AssetImportDecision[] } | null> {
	if (requiresAcknowledgement(preview)) return null;
	if (analysis.choiceConflicts.some((conflict) => conflict.exists)) return null;
	const assetDecisions: AssetImportDecision[] = [];
	for (const conflict of analysis.assetConflicts) {
		const destinationPath = defaultAssetDestination(conflict);
		// A folder there counts too: the review asks for a file name.
		if (conflict.exists || (await app.vault.adapter.exists(destinationPath))) return null;
		assetDecisions.push({ originalPath: conflict.originalPath, destinationPath, mode: "write" });
	}
	return {
		choiceDecisions: analysis.choiceConflicts.map((conflict) => ({ choiceId: conflict.choiceId, mode: "import" })),
		assetDecisions,
	};
}

export async function importPackage(options: {
	app: App;
	pkg: QuickAddPackage;
	choiceDecisions: ChoiceImportDecision[];
	assetDecisions: AssetImportDecision[];
}): Promise<{ result: ApplyImportResult; previousChoices: IChoice[] }> {
	let existingChoices = settingsStore.getState().choices;
	let assetDecisions = options.assetDecisions;
	let result = await applyPackageImport({
		...options,
		existingChoices,
		aiProviders: settingsStore.getState().ai.providers,
	});
	// The choices may have changed while the files were written (a save from
	// another device, an edit in the list). The merge is redone on what the
	// store holds now, with the files already on disk kept as they are, until
	// the choices it was computed from are the ones being replaced.
	const created = createdBy(result, options.assetDecisions);
	for (let attempt = 0; settingsStore.getState().choices !== existingChoices; attempt++) {
		if (attempt === 5) {
			// Give up without leaving half an import: the files this import
			// created go again; a file it replaced cannot be put back.
			for (const path of created) await options.app.vault.adapter.remove(path);
			throw new Error("The choices kept changing while the package was imported. Nothing was imported; try again.");
		}
		existingChoices = settingsStore.getState().choices;
		assetDecisions = keptOnDisk(options.pkg, assetDecisions);
		result = await applyPackageImport({
			...options,
			assetDecisions,
			existingChoices,
			aiProviders: settingsStore.getState().ai.providers,
		});
	}
	settingsStore.setState((state) => ({ ...state, choices: result.updatedChoices }));
	// The choices the final merge replaced, which is what a command sync diffs.
	return { result, previousChoices: existingChoices };
}

/** The files the first pass created, as opposed to replaced. */
function createdBy(result: ApplyImportResult, decisions: AssetImportDecision[]): string[] {
	const writes = new Set(decisions.filter((decision) => decision.mode === "write").map((decision) => decision.destinationPath));
	return result.writtenAssets.filter((path) => writes.has(path));
}

/** The decisions with every file kept where the first pass put it. */
function keptOnDisk(pkg: QuickAddPackage, decisions: AssetImportDecision[]): AssetImportDecision[] {
	const decided = new Map(decisions.map((decision) => [decision.originalPath, decision]));
	return pkg.assets.map((asset) => ({
		originalPath: asset.originalPath,
		destinationPath: decided.get(asset.originalPath)?.destinationPath ?? asset.originalPath,
		mode: "skip",
	}));
}
