import type { CliData, CliFlags } from "obsidian";
import type QuickAdd from "../main";
import { effectiveChoiceMode, reconcileMode } from "../gui/PackageManager/importDecisions";
import type { AssetImportMode, ChoiceImportMode } from "../services/packageImportService";
import { readQuickAddPackage } from "../services/packageImportService";
import { importPackageUnattended } from "../services/packageImportUnattended";
import type IChoice from "../types/choices/IChoice";
import { flattenChoices } from "../utils/choiceUtils";
import { isTruthy } from "./params";

export const PACKAGE_IMPORT_COMMAND = "quickadd:package-import";

export const PACKAGE_IMPORT_FLAGS: CliFlags = {
	path: { value: "<vault-path>", description: "Path to a .quickadd.json package file in the vault" },
	acknowledge: {
		description:
			"Required when the package runs code: confirms you reviewed its scripts (see quickadd:package-preview)",
	},
	choices: {
		value: "import|overwrite|duplicate|skip",
		description:
			"Mode for every choice (default: overwrite when the id already exists, otherwise import). import refuses a package with a choice already in the vault",
	},
	files: {
		value: "write|overwrite|skip",
		description:
			"Mode for every bundled file (default: overwrite when the destination exists, otherwise write)",
	},
};

const CHOICE_MODES = new Set<ChoiceImportMode>(["import", "overwrite", "duplicate", "skip"]);
const ASSET_MODES = new Set<AssetImportMode>(["write", "overwrite", "skip"]);

function parseMode<T extends string>(
	raw: unknown,
	allowed: ReadonlySet<T>,
	flag: string,
): T | undefined {
	const value = typeof raw === "string" ? raw.trim().toLowerCase() : "";
	if (!value) return undefined;
	if (!allowed.has(value as T)) {
		throw new Error(
			`Invalid ${flag}=${raw as string}. Use one of: ${Array.from(allowed).join(", ")}.`,
		);
	}
	return value as T;
}

/**
 * CLI seam for the import modal: same analysis, same trust gate, same default
 * decisions (existing ids are overwritten, templates land in the template
 * folder), then the same apply step. Lets a package be installed and exercised
 * end to end without driving the modal — the docs' example packages are
 * verified this way.
 */
export async function importPackageHandler(
	plugin: QuickAdd,
	params: CliData,
): Promise<{ ok: boolean; [key: string]: unknown }> {
	const path = typeof params.path === "string" ? params.path.trim() : "";
	if (!path) {
		return { ok: false, error: "Missing package path. Provide path=<vault-path>." };
	}
	const choiceMode = parseMode(params.choices, CHOICE_MODES, "choices");
	const assetMode = parseMode(params.files, ASSET_MODES, "files");

	const { pkg } = await readQuickAddPackage(plugin.app, path);
	const outcome = await importPackageUnattended(plugin, pkg, {
		choice: (exists) =>
			effectiveChoiceMode(choiceMode ?? (exists ? "overwrite" : "import"), exists),
		asset: (exists) => reconcileMode(assetMode ?? (exists ? "overwrite" : "write"), exists),
		acknowledged: isTruthy(params.acknowledge),
	});
	if ("needsReview" in outcome) {
		const preview = outcome.needsReview;
		return {
			ok: false,
			error:
				"This package can run code. Review it with quickadd:package-preview, then pass acknowledge=true to import.",
			criticalScriptPaths: preview.criticalScriptPaths,
			capabilities: preview.capabilityRows
				.filter((row) => row.severity === "critical")
				.map((row) => ({ flag: row.flag, title: row.title, detail: row.detail })),
		};
	}
	const result = outcome.imported;

	// Report final ids: a duplicated choice gets a fresh id during apply.
	const updatedById = new Map(
		flattenChoices(result.updatedChoices).map((choice) => [choice.id, choice]),
	);
	const importedNames = [...result.addedChoiceIds, ...result.overwrittenChoiceIds]
		.map((id) => updatedById.get(id))
		.filter((choice): choice is IChoice => Boolean(choice))
		.map((choice) => ({ id: choice.id, name: choice.name, type: choice.type }));

	return {
		ok: true,
		added: result.addedChoiceIds,
		overwritten: result.overwrittenChoiceIds,
		skipped: result.skippedChoiceIds,
		writtenAssets: result.writtenAssets,
		skippedAssets: result.skippedAssets,
		choices: importedNames,
	};
}
