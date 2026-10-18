import type QuickAdd from "../main";
import { settingsStore } from "../settingsStore";
import type { AssetConflict } from "../gui/PackageManager/importDecisions";
import { defaultAssetDestinationFor } from "../gui/PackageManager/importDecisions";
import type { QuickAddPackage } from "../types/packages/QuickAddPackage";
import { syncImportedChoiceCommands } from "./packageImportCommands";
import type {
	ApplyImportResult,
	AssetImportDecision,
	AssetImportMode,
	ChoiceImportDecision,
	ChoiceImportMode,
} from "./packageImportService";
import {
	analysePackage,
	analysePackagePreview,
	applyPackageImport,
	validateAssetDestination,
} from "./packageImportService";
import type { PackagePreview } from "./packagePreview";
import { requiresAcknowledgement } from "./packagePreview";

/** What an import with nobody to ask does with each choice and file, by whether it is already in the vault. */
export interface UnattendedImportOptions {
	choice: (exists: boolean) => ChoiceImportMode;
	asset: (exists: boolean) => AssetImportMode;
	/** The user already reviewed the package's code another way, as the CLI's acknowledge=true says. */
	acknowledged?: boolean;
}

/** The import's result, or the preview of a package that needs the review modal, in which case nothing changed. */
export type UnattendedImportOutcome =
	| { imported: ApplyImportResult }
	| { needsReview: PackagePreview };

/**
 * Where each bundled file lands when nobody edits the destination. The modal
 * lets the reader rename a colliding file; an unattended import cannot, so two
 * templates that share a file name (`One/Meeting.md`, `Two/Meeting.md`) keep
 * their original paths instead of both claiming `Templates/Meeting.md` and
 * having the whole import refused.
 */
function defaultAssetDestinations(
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
 * The import modal's apply step with every decision made up front: the same
 * trust gate, the same analysis, the same default destinations (templates land
 * in the template folder) and the same apply, then the choices are stored,
 * their commands synced and the settings saved.
 */
export function importPackageUnattended(
	plugin: QuickAdd,
	pkg: QuickAddPackage,
	options: UnattendedImportOptions,
): Promise<UnattendedImportOutcome> {
	const run = importQueue.then(() => importNow(plugin, pkg, options));
	// A failed import must not poison the queue for the next one.
	importQueue = run.catch(() => undefined);
	return run;
}

async function importNow(
	plugin: QuickAdd,
	pkg: QuickAddPackage,
	options: UnattendedImportOptions,
): Promise<UnattendedImportOutcome> {
	const { app } = plugin;
	const previousChoices = settingsStore.getState().choices;
	const preview = await analysePackagePreview(app, previousChoices, pkg);
	if (requiresAcknowledgement(preview) && !options.acknowledged) {
		return { needsReview: preview };
	}
	const analysis = await analysePackage(app, previousChoices, pkg);

	const choiceDecisions: ChoiceImportDecision[] = analysis.choiceConflicts.map(
		(conflict) => ({ choiceId: conflict.choiceId, mode: options.choice(conflict.exists) }),
	);

	const destinations = defaultAssetDestinations(
		analysis.assetConflicts,
		settingsStore.getState().templateFolderPaths,
	);
	const assetDecisions: AssetImportDecision[] = [];
	for (const conflict of analysis.assetConflicts) {
		// Ask about the path the write will use, so a padded spelling cannot
		// dodge a skip. Validation also refuses a path outside the vault before
		// anything stats it.
		const destinationPath = validateAssetDestination(
			destinations.get(conflict.originalPath) ?? conflict.originalPath,
		);
		assetDecisions.push({
			originalPath: conflict.originalPath,
			destinationPath,
			mode: options.asset(await app.vault.adapter.exists(destinationPath)),
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
	return { imported: result };
}
