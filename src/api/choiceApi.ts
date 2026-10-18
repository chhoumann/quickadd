import { Notice } from "obsidian";
import type QuickAdd from "../main";
import { promptCancelled } from "../errors/UserCancelError";
import ChoiceSuggester from "../gui/suggesters/choiceSuggester";
import { NO_CHOICES_NOTICE } from "../gui/suggesters/openChoiceLauncher";
import { parseQuickAddPackage } from "../services/packageImportService";
import { importPackageUnattended } from "../services/packageImportUnattended";
import type IChoice from "../types/choices/IChoice";
import type { ChoiceType } from "../types/choices/choiceType";
import type { FlatChoicePathEntry } from "../utils/choiceUtils";
import { findChoiceWithPath, rootChoicesOf } from "../utils/choiceUtils";

/** A choice by its id, or by its name. Names are not unique, so a name means the first match in list order. */
export type ChoiceRef = string | { id: string };

/** What the API tells another plugin about a choice. The choice's own settings stay QuickAdd's. */
export interface ChoiceSummary {
	id: string;
	name: string;
	type: ChoiceType;
	/** Folder names from the root down, the choice's own name last. */
	path: string[];
}

/** What importPackage added and what it left alone because the vault already had it. */
export interface PackageImportSummary {
	addedChoiceIds: string[];
	skippedChoiceIds: string[];
	writtenAssets: string[];
	skippedAssets: string[];
}

/**
 * The choice `ref` names, with its path. Script callers can pass anything, so a
 * ref that is neither a name nor an `{ id }` names nothing.
 */
export function findChoice(choices: IChoice[], ref: ChoiceRef): FlatChoicePathEntry | undefined {
	const [by, value]: ["name" | "id", unknown] =
		typeof ref === "string" ? ["name", ref] : ["id", ref?.id];
	return typeof value === "string" ? findChoiceWithPath(choices, by, value) : undefined;
}

export function summarizeChoice({ choice, path }: FlatChoicePathEntry): ChoiceSummary {
	return { id: choice.id, name: choice.name, type: choice.type, path };
}

/**
 * Opens the launcher's picker in pick mode and resolves with the Template,
 * Capture or Macro the user picks, running nothing. Rejects with
 * `promptCancelled()` when the picker is dismissed, and, after the launcher's
 * notice, when there are no choices to pick from.
 */
export function pickChoice(
	plugin: QuickAdd,
	options?: { placeholder?: string },
): Promise<ChoiceSummary> {
	const choices = rootChoicesOf(plugin.settings.choices);
	if (choices.length === 0) {
		new Notice(NO_CHOICES_NOTICE, 8000);
		return Promise.reject(promptCancelled());
	}
	return new Promise((resolve, reject) => {
		ChoiceSuggester.Open(plugin, choices, {
			placeholder: options?.placeholder,
			// Looked up again in the live tree, since a sync can change the
			// choices while the picker is open.
			onPick: (choice) => {
				const picked = findChoice(plugin.settings.choices, { id: choice.id });
				if (picked) resolve(summarizeChoice(picked));
				else reject(promptCancelled());
			},
			// Pick mode settles the completion only when nothing was picked.
			completion: () => reject(promptCancelled()),
		});
	});
}

/**
 * Imports a package the calling plugin ships, with no review modal: a choice
 * whose id is already in the vault and a file that already exists are skipped,
 * never overwritten. Throws before changing anything when the package is
 * invalid, or when it needs the review modal, as a package that runs code does.
 */
export async function importPackage(
	plugin: QuickAdd,
	packageJson: string,
): Promise<PackageImportSummary> {
	const outcome = await importPackageUnattended(plugin, parseQuickAddPackage(packageJson), {
		choice: (exists) => (exists ? "skip" : "import"),
		asset: (exists) => (exists ? "skip" : "write"),
	});
	if ("needsReview" in outcome) {
		throw new Error(
			"This package needs review, so it can only be imported from QuickAdd's settings.",
		);
	}
	const { addedChoiceIds, skippedChoiceIds, writtenAssets, skippedAssets } = outcome.imported;
	return { addedChoiceIds, skippedChoiceIds, writtenAssets, skippedAssets };
}
