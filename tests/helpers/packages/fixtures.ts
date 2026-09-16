import type { QuickAddPackageAsset, QuickAddPackageAssetKind } from "../../../src/types/packages/QuickAddPackage";

export function packageAsset(
	kind: QuickAddPackageAssetKind,
	originalPath: string,
	content: string,
): QuickAddPackageAsset {
	return { kind, originalPath, contentEncoding: "base64", content };
}

import { applyPackageImport, type ApplyImportOptions } from "../../../src/services/packageImportService";

export function importPackage(
	options: Pick<ApplyImportOptions, "app" | "pkg"> & Partial<ApplyImportOptions>,
) {
	return applyPackageImport({
		existingChoices: [],
		choiceDecisions: [],
		assetDecisions: [],
		...options,
	});
}
