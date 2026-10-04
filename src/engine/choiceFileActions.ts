import type { App, TFile, WorkspaceLeaf } from "obsidian";
import type { IChoiceExecutor } from "../IChoiceExecutor";
import { log } from "../logger/logManager";
import { type normalizeAppendLinkOptions, type AppendLinkOptions, placementSupportsFrontmatter } from "../types/linkPlacement";
import { insertFileLinkToActiveView } from "../utils/editorInsertion";
import { openExistingFileTab, openFile } from "../utils/fileOpening";
import { normalizeFileOpening } from "../utils/fileOpeningDefaults";
import { appendFileLinkToDestinationFile, copyFileLinkToClipboard, getAppendLinkDestinationFile } from "../utils/fileLinks";
import { appendLinkToFrontmatterProperty } from "../utils/frontmatterPropertyLinks";
import type { EditorTextMutationObserver } from "../utils/editorCursorPlacement";

type LinkOptions = ReturnType<typeof normalizeAppendLinkOptions>;

export function appendLinkDestinationError(app: App, options: LinkOptions): string | null {
	if (!options.enabled || options.destination.type !== "specifiedFile" ||
		getAppendLinkDestinationFile(app, options.destination)) return null;
	return `Append link target file not found or is not a Markdown file: ${options.destination.path}`;
}

export async function insertChoiceFileLink(
	app: App, file: TFile, options: AppendLinkOptions,
	focusedProperty: IChoiceExecutor["focusedProperty"],
	onEditorTextMutation?: EditorTextMutationObserver,
): Promise<void> {
	if (!options.enabled) return;
	if (options.destination?.type === "specifiedFile") {
		await appendFileLinkToDestinationFile(app, file, options, onEditorTextMutation);
	} else if (focusedProperty && !placementSupportsFrontmatter(options.placement)) {
		await appendLinkToFrontmatterProperty(app, focusedProperty, file);
	} else {
		if (onEditorTextMutation) await insertFileLinkToActiveView(app, file, options, onEditorTextMutation);
		else await insertFileLinkToActiveView(app, file, options);
	}
}

/** The note {@link insertChoiceFileLink} puts the link in, branch for branch. */
export function linkDestinationFile(
	app: App, options: AppendLinkOptions, focusedProperty: IChoiceExecutor["focusedProperty"],
): TFile | null {
	if (!options.enabled) return null;
	if (options.destination?.type === "specifiedFile") return getAppendLinkDestinationFile(app, options.destination);
	if (focusedProperty && !placementSupportsFrontmatter(options.placement)) return focusedProperty.file;
	return app.workspace.getActiveFile();
}

export async function copyChoiceFileLink(file: TFile): Promise<void> {
	try {
		await copyFileLinkToClipboard(file);
	} catch (error) {
		log.logWarning(`Could not copy link to clipboard for '${file.path}': ${
			error instanceof Error ? error.message : String(error)
		}`);
	}
}

export async function openChoiceFile({ app, file, opening, originLeaf, forceFocus }: {
	app: App;
	file: TFile;
	opening: Parameters<typeof normalizeFileOpening>[0];
	originLeaf: WorkspaceLeaf | null;
	forceFocus?: boolean;
}): Promise<boolean> {
	const options = normalizeFileOpening(opening);
	const focus = forceFocus ?? options.focus ?? true;
	if (!openExistingFileTab(app, file, focus)) {
		await openFile(app, file, {
			...options,
			...(forceFocus === undefined ? {} : { focus: forceFocus }),
			originLeaf,
		});
	}
	return focus;
}
