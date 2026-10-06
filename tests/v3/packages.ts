import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { walkChoiceTree } from "../../src/migrations/helpers/choice-traversal";
import { normalizeImportedChoice } from "../../src/services/packageChoiceImport";
import type IChoice from "../../src/types/choices/IChoice";
import type { QuickAddPackage } from "../../src/types/packages/QuickAddPackage";

const packagesDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../docs/public/packages");

/**
 * The root choices of every docs package, normalized the way import normalizes
 * them. A package lists a folder's children flat as well as inline; import
 * installs the folder with them inline, so the flat copies are left out here
 * too, or every child would appear twice under one id.
 */
export function packageChoices(): { pkg: string; choice: IChoice }[] {
	return readdirSync(packagesDir)
		.filter((file) => file.endsWith(".quickadd.json"))
		.sort()
		.flatMap((file) => {
			const pkg = JSON.parse(readFileSync(path.join(packagesDir, file), "utf8")) as QuickAddPackage;
			const ids = new Set(pkg.choices.map(({ choice }) => choice.id));
			return pkg.choices
				.filter(({ parentChoiceId }) => !parentChoiceId || !ids.has(parentChoiceId))
				.map(({ choice }) => {
					walkChoiceTree(choice, normalizeImportedChoice);
					return { pkg: file.replace(".quickadd.json", ""), choice };
				});
		});
}
