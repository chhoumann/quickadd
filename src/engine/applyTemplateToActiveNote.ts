import type { App, TFile } from "obsidian";
import { Notice } from "obsidian";
import GenericSuggester from "../gui/GenericSuggester/genericSuggester";
import GenericYesNoPrompt from "../gui/GenericYesNoPrompt/GenericYesNoPrompt";
import type { IChoiceExecutor } from "../IChoiceExecutor";
import { log } from "../logger/logManager";
import type QuickAdd from "../main";
import type IChoice from "../types/choices/IChoice";
import type ITemplateChoice from "../types/choices/ITemplateChoice";
import { jumpToNextTemplaterCursorIfPossible } from "../utilityObsidian";
import { flattenChoices } from "../utils/choiceUtils";
import { isCancellationError, reportError } from "../utils/errorUtils";
import {
	getMarkdownEditorViewForFile,
	TemplateInsertEngine,
	templateInsertModes,
	type TemplateInsertModeId,
} from "./TemplateInsertEngine";

export type TemplatePickerItem =
	| { kind: "choice"; choice: ITemplateChoice }
	| { kind: "file"; path: string };

export interface ApplyTemplateToNoteParams {
	/** Target note; defaults to the active file. */
	file?: TFile;
	/** Non-interactive template source; skips the template picker. */
	templatePath?: string;
	/** Non-interactive insert mode; skips the mode picker. */
	mode?: TemplateInsertModeId;
	choiceExecutor: IChoiceExecutor;
}

/** A note that only contains whitespace is treated as empty (fast path). */
export function isNoteEffectivelyEmpty(content: string): boolean {
	return content.trim().length === 0;
}

export function templatePickerItemLabel(item: TemplatePickerItem): string {
	return item.kind === "choice"
		? `Choice: ${item.choice.name}`
		: `Template: ${item.path}`;
}

function normalizeTemplatePathForComparison(path: string): string {
	const stripped = path.replace(/^\/+/, "").toLowerCase();
	return /\.(md|canvas|base)$/.test(stripped) ? stripped : `${stripped}.md`;
}

/**
 * Builds the template picker list: Template choices first (flattened from
 * Multis), then raw template files not already covered by a choice.
 */
export function buildTemplatePickerItems(
	choices: IChoice[],
	templateFilePaths: string[],
): TemplatePickerItem[] {
	const templateChoices = flattenChoices(choices).filter(
		(choice): choice is ITemplateChoice =>
			choice.type === "Template" &&
			Boolean((choice as ITemplateChoice).templatePath),
	);

	const coveredPaths = new Set(
		templateChoices.map((choice) =>
			normalizeTemplatePathForComparison(choice.templatePath),
		),
	);

	const items: TemplatePickerItem[] = templateChoices.map((choice) => ({
		kind: "choice",
		choice,
	}));

	for (const path of templateFilePaths) {
		if (coveredPaths.has(normalizeTemplatePathForComparison(path))) continue;
		items.push({ kind: "file", path });
	}

	return items;
}

/**
 * Applies a template to an existing note (issue #526).
 *
 * Interactive flow (no templatePath given): pick a Template choice or
 * template file, then — unless the note is empty, which applies the template
 * directly — pick how to insert it. Choice-backed picks may end with an
 * offer to move/rename the note to match the choice's folder and file name
 * settings.
 *
 * Non-interactive flow (templatePath given, e.g. via the API): no pickers
 * and no reconciliation prompt. Mode defaults to "replace" for empty notes
 * and "bottom" otherwise.
 */
export async function applyTemplateToNote(
	app: App,
	plugin: QuickAdd,
	params: ApplyTemplateToNoteParams,
): Promise<TFile | null> {
	try {
		const file = params.file ?? app.workspace.getActiveFile();
		if (!file || file.extension !== "md") {
			new Notice("QuickAdd: No active markdown note to apply a template to.");
			return null;
		}

		const interactive = !params.templatePath;
		let source: TemplatePickerItem;
		if (params.templatePath) {
			source = { kind: "file", path: params.templatePath };
		} else {
			const picked = await pickTemplate(app, plugin);
			if (!picked) return null;
			source = picked;
		}

		const templatePath =
			source.kind === "choice" ? source.choice.templatePath : source.path;

		const noteContent = await app.vault.cachedRead(file);
		const noteIsEmpty = isNoteEffectivelyEmpty(noteContent);

		let mode: TemplateInsertModeId;
		if (params.mode) {
			mode = params.mode;
		} else if (noteIsEmpty) {
			// Empty-note fast path: the most common case is a freshly created
			// blank note, so skip the mode picker and apply the template as-is.
			mode = "replace";
		} else if (!interactive) {
			mode = "bottom";
		} else {
			const pickedMode = await pickInsertMode(app, file);
			if (!pickedMode) return null;
			mode = pickedMode;
		}

		// Pre-fill the unnamed {{VALUE}} with the note's basename: the note
		// already has a name, so don't re-ask for it. setTitle() in the engine
		// covers {{title}} the same way.
		if (!params.choiceExecutor.variables.has("value")) {
			params.choiceExecutor.variables.set("value", file.basename);
		}

		const engine = new TemplateInsertEngine(
			app,
			plugin,
			file,
			templatePath,
			mode,
			params.choiceExecutor,
		);
		const result = await engine.apply();
		if (!result) return null;

		if (interactive && source.kind === "choice") {
			await maybeReconcileNoteLocation(app, engine, source.choice, file);
		}

		await jumpToNextTemplaterCursorIfPossible(app, file);
		new Notice(`Applied template to '${file.basename}'.`);
		return file;
	} catch (err) {
		if (isCancellationError(err) || isAbortError(err)) {
			return null;
		}
		reportError(err, "Error applying template to note");
		return null;
	}
}

function isAbortError(error: unknown): boolean {
	return (
		Boolean(error) &&
		typeof error === "object" &&
		(error as { name?: string }).name === "MacroAbortError"
	);
}

async function pickTemplate(
	app: App,
	plugin: QuickAdd,
): Promise<TemplatePickerItem | null> {
	const items = buildTemplatePickerItems(
		plugin.settings.choices,
		plugin.getTemplateFiles().map((file) => file.path),
	);

	if (items.length === 0) {
		new Notice(
			"QuickAdd: No Template choices or template files found. Create a Template choice or set the template folder path in settings.",
		);
		return null;
	}

	try {
		return await GenericSuggester.Suggest(
			app,
			items.map(templatePickerItemLabel),
			items,
			"Apply template to note",
		);
	} catch (error) {
		if (isCancellationError(error)) return null;
		throw error;
	}
}

async function pickInsertMode(
	app: App,
	file: TFile,
): Promise<TemplateInsertModeId | null> {
	const cursorAvailable = Boolean(getMarkdownEditorViewForFile(app, file));
	const modes = templateInsertModes.filter(
		(mode) => mode.id !== "cursor" || cursorAvailable,
	);

	try {
		return await GenericSuggester.Suggest(
			app,
			modes.map((mode) => mode.label),
			modes.map((mode) => mode.id),
			"How should the template be applied?",
		);
	} catch (error) {
		if (isCancellationError(error)) return null;
		throw error;
	}
}

/**
 * If the picked Template choice would have created the note at a different
 * path (folder settings + file name format), offer to move/rename the note
 * to match. Skipped when the target can't be resolved non-interactively or
 * already exists.
 */
async function maybeReconcileNoteLocation(
	app: App,
	engine: TemplateInsertEngine,
	choice: ITemplateChoice,
	file: TFile,
): Promise<void> {
	try {
		const targetPath = await engine.computeChoiceTargetPath(choice);
		if (!targetPath || targetPath === file.path) return;
		if (await app.vault.adapter.exists(targetPath)) return;

		const shouldMove = await GenericYesNoPrompt.Prompt(
			app,
			"Move note to match choice settings?",
			`'${choice.name}' creates notes at '${targetPath}'. Move '${file.path}' there? Links to the note will be updated.`,
		);
		if (!shouldMove) return;

		const lastSlash = targetPath.lastIndexOf("/");
		const targetFolder = lastSlash === -1 ? "" : targetPath.slice(0, lastSlash);
		if (targetFolder && !(await app.vault.adapter.exists(targetFolder))) {
			await app.vault.createFolder(targetFolder);
		}

		await app.fileManager.renameFile(file, targetPath);
	} catch (error) {
		if (isCancellationError(error) || isAbortError(error)) return;
		log.logWarning(`Could not move note to match choice settings: ${error}`);
	}
}
