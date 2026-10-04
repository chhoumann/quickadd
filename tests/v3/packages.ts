import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { walkChoiceTree } from "../../src/migrations/helpers/choice-traversal";
import { normalizeImportedChoice } from "../../src/services/packageChoiceImport";
import type IChoice from "../../src/types/choices/IChoice";
import type { QuickAddPackage } from "../../src/types/packages/QuickAddPackage";

const packagesDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../docs/public/packages");

/** Every choice entry of every docs package, normalized the way import normalizes it. */
export function packageChoices(): { pkg: string; choice: IChoice }[] {
	return readdirSync(packagesDir)
		.filter((file) => file.endsWith(".quickadd.json"))
		.sort()
		.flatMap((file) => {
			const pkg = JSON.parse(readFileSync(path.join(packagesDir, file), "utf8")) as QuickAddPackage;
			return pkg.choices.map(({ choice }) => {
				walkChoiceTree(choice, normalizeImportedChoice);
				return { pkg: file.replace(".quickadd.json", ""), choice };
			});
		});
}
