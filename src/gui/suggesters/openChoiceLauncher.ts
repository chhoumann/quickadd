import { Notice } from "obsidian";
import type { IChoiceExecutor } from "../../IChoiceExecutor";
import type { AppProvider, PluginManifestInfo, SettingsProvider, TemplateFileSource } from "../../types/pluginContext";
import { NO_CHOICES_NOTICE } from "../../utils/choiceNotices";
import { openQuickAddSettings } from "../../utils/openPluginSettings";
import ChoiceSuggester, { shouldShowTemplateFolderRow } from "./choiceSuggester";

/**
 * Opens the top-level choice launcher (the "QuickAdd: Run" command and the
 * ribbon icon).
 *
 * On a fresh install this used to open a fuzzy picker with a blank input over
 * Obsidian's bare "No results found.": the first thing a new user does landing
 * on a dead end, with no hint that choices live in settings (issue #1540). When
 * there is genuinely nothing to pick, say so and take them where they need to
 * go instead of opening an empty picker.
 *
 * "Nothing to pick" means no choices AND no "New note from template" row, since
 * that synthetic row is a working action in its own right.
 *
 * `createExecutor` builds the executor that runs the picked choice, once there
 * is something to pick.
 */
export function openChoiceLauncher(
	plugin: AppProvider & SettingsProvider & TemplateFileSource & PluginManifestInfo,
	createExecutor: () => IChoiceExecutor,
): void {
	// main.ts deliberately leaves a corrupt (non-array) `choices` intact rather
	// than overwriting the user's data, so normalize here: a broken data.json
	// should land on the first-run guidance, not a bare TypeError.
	const choices = Array.isArray(plugin.settings.choices)
		? plugin.settings.choices
		: [];
	const hasSomethingToPick =
		choices.length > 0 || shouldShowTemplateFolderRow(plugin);

	if (!hasSomethingToPick) {
		new Notice(NO_CHOICES_NOTICE, 8000);
		openQuickAddSettings(plugin.app, plugin.manifest.id, { notice: false });
		return;
	}

	ChoiceSuggester.Open(plugin, choices, {
		choiceExecutor: createExecutor(),
		includeTemplateFolderRow: true,
	});
}
