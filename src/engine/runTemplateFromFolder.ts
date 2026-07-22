import type { App, TFile } from "obsidian";
import { Notice } from "obsidian";
import { VALUE_SYNTAX } from "../constants";
import GenericSuggester from "../gui/GenericSuggester/genericSuggester";
import type { IChoiceExecutor } from "../IChoiceExecutor";
import type QuickAdd from "../main";
import type ITemplateChoice from "../types/choices/ITemplateChoice";
import { TemplateChoice } from "../types/choices/TemplateChoice";
import { normalizeTemplateFolderPaths } from "../utilityObsidian";
import { isCancellationError, reportError } from "../utils/errorUtils";
import { tryOpenPluginSettings } from "../utils/openPluginSettings";

export interface RunTemplateFromFolderParams {
	/** When set, skips the picker and runs this template directly (CLI / scripted). */
	templatePath?: string;
	choiceExecutor: IChoiceExecutor;
}

/** Basename without its extension, used as the ephemeral choice name + prompt header. */
function templateDisplayName(path: string): string {
	const file = path.split("/").pop() ?? path;
	const dot = file.lastIndexOf(".");
	return dot > 0 ? file.slice(0, dot) : file;
}

/**
 * Builds the throwaway TemplateChoice that powers "New note from template".
 * Not persisted and never added to settings.choices — it exists only for the
 * duration of one ChoiceExecutor.execute() call.
 *
 * `fileNameFormat.enabled` MUST be true. Runtime is identical to `enabled:false`
 * (TemplateChoiceEngine resolves both to VALUE_SYNTAX), but collectChoiceRequirements
 * only scans the file-name format when it is enabled — so with `enabled:false` the
 * implicit {{value}} note-name prompt is invisible to the non-interactive CLI guard
 * (it would pass with zero unresolved inputs and then hang on an interactive prompt)
 * and to the one-page input form (which would omit the name field).
 */
export function createFolderTemplateChoice(templatePath: string): ITemplateChoice {
	const choice = new TemplateChoice(templateDisplayName(templatePath));
	choice.templatePath = templatePath;
	// Creating a brand-new note from a template — land in it, like the user expects.
	choice.openFile = true;
	choice.fileNameFormat = { enabled: true, format: VALUE_SYNTAX };
	choice.discoverExistingNotesBeforeCreate = true;
	return choice;
}

/** Whether at least one template folder is configured (empty = whole vault, which we refuse). */
export function hasConfiguredTemplateFolders(plugin: QuickAdd): boolean {
	return (
		normalizeTemplateFolderPaths(plugin.settings.templateFolderPaths).length > 0
	);
}

function renderTemplateRow(path: string, el: HTMLElement): void {
	const lastSlash = path.lastIndexOf("/");
	const folder = lastSlash === -1 ? "" : path.slice(0, lastSlash);
	const content = el.createDiv({ cls: "suggestion-content" });
	content.createDiv({ cls: "suggestion-title", text: templateDisplayName(path) });
	if (folder) {
		el.classList.add("mod-complex");
		content.createDiv({ cls: "suggestion-note", text: folder });
	}
}

async function pickTemplateFile(
	app: App,
	files: TFile[],
): Promise<string | null> {
	// Stable, path-sorted list; full path is the searchable text so a query can
	// match folder + name, while the custom row shows basename + folder.
	const sorted = [...files].sort((a, b) => a.path.localeCompare(b.path));
	const paths = sorted.map((file) => file.path);

	try {
		return await GenericSuggester.Suggest(
			app,
			paths,
			paths,
			"New note from template",
			(path, el) => renderTemplateRow(path, el),
		);
	} catch (error) {
		if (isCancellationError(error)) return null;
		throw error;
	}
}

/**
 * Runs a template straight from the configured template folder, prompting for
 * the new note name — without a dedicated Template choice (issue #1023).
 *
 * Interactive (no templatePath): require a configured template folder, list its
 * templates, then run the picked one. Non-interactive (templatePath given, e.g.
 * the CLI): skip the picker and the config gate and run it directly.
 */
export async function runTemplateFromFolder(
	app: App,
	plugin: QuickAdd,
	params: RunTemplateFromFolderParams,
): Promise<void> {
	try {
		let templatePath = params.templatePath?.trim() || undefined;

		if (!templatePath) {
			if (!hasConfiguredTemplateFolders(plugin)) {
				new Notice(
					"QuickAdd: Set a template folder in Settings → QuickAdd → Templates & Properties to use “New note from template”.",
					8000,
				);
				tryOpenPluginSettings(app, plugin.manifest.id);
				return;
			}

			const files = plugin.getTemplateFiles();
			if (files.length === 0) {
				new Notice(
					"QuickAdd: No template files found in your configured template folder(s).",
				);
				return;
			}

			const picked = await pickTemplateFile(app, files);
			if (!picked) return;
			templatePath = picked;
		}

		await params.choiceExecutor.execute(createFolderTemplateChoice(templatePath));
	} catch (error) {
		if (isCancellationError(error)) return;
		reportError(error, "Error running template from folder");
	}
}
