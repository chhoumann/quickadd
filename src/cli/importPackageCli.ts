import type { CliData, CliFlags } from "obsidian";
import type QuickAdd from "../main";
import { settingsStore } from "../settingsStore";
import type { AssetConflict } from "../gui/PackageManager/importDecisions";
import {
	defaultAssetDestinationFor,
	effectiveChoiceMode,
	reconcileMode,
} from "../gui/PackageManager/importDecisions";
import { syncImportedChoiceCommands } from "../services/packageImportCommands";
import type {
	AssetImportDecision,
	AssetImportMode,
	ChoiceImportDecision,
	ChoiceImportMode,
} from "../services/packageImportService";
import {
	analysePackage,
	analysePackagePreview,
	applyPackageImport,
	readQuickAddPackage,
} from "../services/packageImportService";
import { requiresAcknowledgement } from "../services/packagePreview";
import type IChoice from "../types/choices/IChoice";
import { flattenChoices } from "../utils/choiceUtils";
import { escapesVaultBoundary } from "../utils/vaultPathBoundary";
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
			"Mode for every choice (default: overwrite when the id already exists, otherwise import)",
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
 * Where each bundled file lands when nobody edits the destination. The modal
 * lets the reader rename a colliding file; the CLI cannot, so two templates
 * that share a file name (`One/Meeting.md`, `Two/Meeting.md`) keep their
 * original paths instead of both claiming `Templates/Meeting.md` and having
 * the whole import refused.
 */
export function cliAssetDestinations(
	conflicts: ReadonlyArray<Pick<AssetConflict, "kind" | "originalPath">>,
	templateFolderPaths: unknown,
): Map<string, string> {
	const defaults = new Map(
		conflicts.map((conflict) => [
			conflict.originalPath,
			defaultAssetDestinationFor(conflict, templateFolderPaths),
		]),
	);
	// Fold case unconditionally: on a case-sensitive vault this only sends an
	// extra file back to its original path, which is always a valid choice.
	const claims = new Map<string, number>();
	for (const destination of defaults.values()) {
		const key = destination.toLowerCase();
		claims.set(key, (claims.get(key) ?? 0) + 1);
	}
	for (const [originalPath, destination] of defaults) {
		if ((claims.get(destination.toLowerCase()) ?? 0) > 1) {
			defaults.set(originalPath, originalPath);
		}
	}
	return defaults;
}

// Imports read the choices, analyse, write files, then store the merged
// choices. Two overlapping runs would each merge into the snapshot they took
// and the later store would drop the earlier import, so runs are queued.
let importQueue: Promise<unknown> = Promise.resolve();

/**
 * CLI seam for the import modal: same analysis, same trust gate, same default
 * decisions (existing ids are overwritten, templates land in the template
 * folder), then the same apply step. Lets a package be installed and exercised
 * end to end without driving the modal — the docs' example packages are
 * verified this way.
 */
export function importPackageHandler(
	plugin: QuickAdd,
	params: CliData,
): Promise<{ ok: boolean; [key: string]: unknown }> {
	const run = importQueue.then(() => importPackage(plugin, params));
	// A failed import must not poison the queue for the next one.
	importQueue = run.catch(() => undefined);
	return run;
}

async function importPackage(
	plugin: QuickAdd,
	params: CliData,
): Promise<{ ok: boolean; [key: string]: unknown }> {
	const path = typeof params.path === "string" ? params.path.trim() : "";
	if (!path) {
		return { ok: false, error: "Missing package path. Provide path=<vault-path>." };
	}
	const choiceMode = parseMode(params.choices, CHOICE_MODES, "choices");
	const assetMode = parseMode(params.files, ASSET_MODES, "files");

	const { app } = plugin;
	const { pkg } = await readQuickAddPackage(app, path);
	const previousChoices = settingsStore.getState().choices;
	const analysis = await analysePackage(app, previousChoices, pkg);
	const preview = await analysePackagePreview(app, previousChoices, pkg);

	if (requiresAcknowledgement(preview) && !isTruthy(params.acknowledge)) {
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

	const choiceDecisions: ChoiceImportDecision[] = analysis.choiceConflicts.map(
		(conflict) => ({
			choiceId: conflict.choiceId,
			mode: effectiveChoiceMode(
				choiceMode ?? (conflict.exists ? "overwrite" : "import"),
				conflict.exists,
			),
		}),
	);

	const destinations = cliAssetDestinations(
		analysis.assetConflicts,
		settingsStore.getState().templateFolderPaths,
	);
	const assetDecisions: AssetImportDecision[] = [];
	for (const conflict of analysis.assetConflicts) {
		const destinationPath =
			destinations.get(conflict.originalPath) ?? conflict.originalPath;
		// applyPackageImport rejects a destination outside the vault; do not
		// stat it first (the package, and so this path, is untrusted input).
		const exists =
			destinationPath === conflict.originalPath
				? conflict.exists
				: !escapesVaultBoundary(destinationPath) &&
					(await app.vault.adapter.exists(destinationPath));
		assetDecisions.push({
			originalPath: conflict.originalPath,
			destinationPath,
			mode: reconcileMode(assetMode ?? (exists ? "overwrite" : "write"), exists),
		});
	}

	const result = await applyPackageImport({
		app,
		existingChoices: previousChoices,
		aiProviders: settingsStore.getState().ai.providers,
		pkg,
		choiceDecisions,
		assetDecisions,
	});

	settingsStore.setState((state) => ({ ...state, choices: result.updatedChoices }));
	syncImportedChoiceCommands(plugin, previousChoices, result);
	await plugin.saveSettings();

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
