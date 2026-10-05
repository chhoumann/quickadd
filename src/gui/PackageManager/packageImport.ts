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
	const previousChoices = settingsStore.getState().choices;
	const result = await applyPackageImport({
		...options,
		existingChoices: previousChoices,
		aiProviders: settingsStore.getState().ai.providers,
	});
	settingsStore.setState((state) => ({ ...state, choices: result.updatedChoices }));
	return { result, previousChoices };
}
