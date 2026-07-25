import { Notice } from "obsidian";
import type QuickAdd from "../../main";
import { openQuickAddSettings } from "../../utils/openPluginSettings";
import ChoiceSuggester, { shouldShowTemplateFolderRow } from "./choiceSuggester";

/**
 * What the user is told when "QuickAdd: Run" has nothing to run. Mirrors the
 * shape of the plugin's other "this surface has nothing to offer" notices
 * (runTemplateFromFolder's missing-template-folder notice), which name the exact
 * settings path rather than leaving the user to find it.
 */
export const NO_CHOICES_NOTICE =
	"QuickAdd: No choices yet. Create your first one in Settings → QuickAdd.";

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
 */
export function openChoiceLauncher(plugin: QuickAdd): void {
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
		includeTemplateFolderRow: true,
	});
}
