import { TFolder, type App } from "obsidian";
import { BASE_FILE_EXTENSION_REGEX, CANVAS_FILE_EXTENSION_REGEX, MARKDOWN_FILE_EXTENSION_REGEX, VALUE_SYNTAX } from "src/constants";
import { isRunNoteToken } from "src/engine/CaptureTargetEngine";
import { resolveCaptureTarget } from "src/engine/helpers/captureTargetResolution";
import type { FileNameDisplayFormatter } from "src/formatters/fileNameDisplayFormatter";
import type { PreviewDiagnostic } from "src/formatters/previewDiagnostics";
import { describeCaptureTarget } from "src/formatters/promptScope";
import type { IChoiceExecutor } from "src/IChoiceExecutor";
import type ICaptureChoice from "src/types/choices/ICaptureChoice";
import type ITemplateChoice from "src/types/choices/ITemplateChoice";
import { findInlineScriptSpans } from "src/formatters/helpers/inlineScriptSpans";
import { isFolder } from "src/utils/vaultQueries";

/**
 * Where a run lands, said the same way by the one-page form's preview and by
 * the context line under the last sequential prompt.
 */

/** A capture target the run asks for: a folder, a filter or the whole vault. */
export const PICKED_NOTE = "a note you pick";
/** The active file, as a capture target. */
export const CURRENT_NOTE = "the current note";
/** A Template's folder that the run asks for. */
export const ASKED_FOLDER = "{folder}";

/**
 * The heading a capture writes under, when that is a fixed heading. A line
 * with tokens is only known once the run formats it, a picked heading only
 * once it is picked, and any other line is an anchor rather than a section.
 */
export function captureHeading(choice: ICaptureChoice): string | undefined {
	const insertAfter = choice.insertAfter;
	if (choice.propertyCapture || !insertAfter?.enabled || insertAfter.promptHeading) return undefined;
	const line = insertAfter.after?.trim();
	return line && /^#{1,6}\s/.test(line) && !line.includes("{{") ? line : undefined;
}

function stripLeadingSlash(path: string): string {
	return path.replace(/^\/+/, "");
}

/**
 * The new note's path: `name` in `folder`, or in {@link ASKED_FOLDER} when the
 * folder is `null` because the run asks for it. Mirrors the run's assembly: a
 * name that already starts with the folder is not put in it twice, and the
 * template decides the extension.
 */
export function newNotePath(folder: string | null, name: string, templatePath: string): string {
	const extension = CANVAS_FILE_EXTENSION_REGEX.test(templatePath)
		? ".canvas"
		: BASE_FILE_EXTENSION_REGEX.test(templatePath) ? ".base" : ".md";
	const bare = stripLeadingSlash(name)
		.replace(MARKDOWN_FILE_EXTENSION_REGEX, "")
		.replace(CANVAS_FILE_EXTENSION_REGEX, "")
		.replace(BASE_FILE_EXTENSION_REGEX, "");
	const dir = folder === null ? ASKED_FOLDER : stripLeadingSlash(folder).replace(/\/+$/, "");
	const inFolder = dir && bare.startsWith(`${dir}/`) ? bare.slice(dir.length + 1) : bare;
	return dir ? `${dir}/${inFolder}${extension}` : `${inFolder}${extension}`;
}

/**
 * The folder a Template run creates its note in, when it is known without
 * asking: the one configured folder (formatted, unless it holds a script the
 * preview must not run), or Obsidian's default location for new notes. `null`
 * when the run asks.
 */
async function templateFolder(
	app: App,
	choice: ITemplateChoice,
	formatter: FileNameDisplayFormatter,
): Promise<string | null> {
	const { folder } = choice;
	if (folder?.enabled) {
		const only = folder.folders?.length === 1 ? folder.folders[0]?.trim() : "";
		const asks = folder.chooseWhenCreatingNote || folder.chooseFromSubfolders ||
			folder.createInSameFolderAsActiveFile || !only;
		if (asks || findInlineScriptSpans(only).length > 0) return null;
		return only.includes("{{") ? await formatter.format(only) : only;
	}
	const parent = app.fileManager.getNewFileParent(app.workspace.getActiveFile()?.path ?? "");
	return parent.path === "/" ? "" : parent.path;
}

/**
 * The note a Template run creates, with the answers so far, and what the name
 * format ran into. `formatter` holds the answers and the run's clocks.
 */
export async function previewNewNotePath(
	app: App,
	choice: ITemplateChoice,
	formatter: FileNameDisplayFormatter,
): Promise<{ path: string; diagnostics: readonly PreviewDiagnostic[] }> {
	const folder = await templateFolder(app, choice, formatter);
	// {{FOLDER}} in the name is the folder the run picks, named as the row
	// names it while it is still to be asked.
	formatter.setTargetFolderPath(folder ?? ASKED_FOLDER);
	const name = await formatter.format(
		choice.fileNameFormat?.enabled ? choice.fileNameFormat.format : VALUE_SYNTAX,
	);
	const diagnostics = formatter.diagnostics.list();
	// With no folder configured, a name that starts at a root folder is a path
	// from the vault root, as the run reads it.
	const rootFolder = stripLeadingSlash(name).split("/")[0];
	const fromRoot = !choice.folder?.enabled && name.includes("/") &&
		(name.startsWith("/") || app.vault.getAbstractFileByPath(rootFolder) instanceof TFolder);
	return { path: newNotePath(fromRoot ? "" : folder, name, choice.templatePath ?? ""), diagnostics };
}

/**
 * Where a Capture run adds its text, with the answers so far: the note path,
 * {@link PICKED_NOTE} or {@link CURRENT_NOTE}, and the heading. `undefined`
 * when the run note is still to be made by an earlier step.
 */
export async function previewCaptureTarget(
	app: App,
	choice: ICaptureChoice,
	formatter: FileNameDisplayFormatter,
	executor: IChoiceExecutor,
): Promise<{ text: string; diagnostics: readonly PreviewDiagnostic[] } | undefined> {
	const heading = captureHeading(choice);
	if (choice.captureToActiveFile) {
		return { text: describeCaptureTarget(CURRENT_NOTE, heading), diagnostics: [] };
	}
	if (isRunNoteToken(choice.captureTo)) {
		const runNote = executor.runNote?.path;
		return runNote ? { text: describeCaptureTarget(runNote, heading), diagnostics: [] } : undefined;
	}
	const formatted = await formatter.withPromptScope("captureTarget", choice.captureTo ?? "",
		() => formatter.format(choice.captureTo ?? ""));
	// The target may be picker syntax such as `property:type=draft`, which is
	// never a path, so the vault's path rules do not apply to it.
	const diagnostics = formatter.diagnostics.list().filter((diagnostic) => diagnostic.kind !== "path");
	// A periodic note is a file, even when a folder has its name.
	if (formatted === formatter.periodicNoteTarget?.path) {
		return { text: describeCaptureTarget(withNoteExtension(formatted), heading), diagnostics };
	}
	const resolution = resolveCaptureTarget(formatted, {
		getAbstractFileByPath: (path) => app.vault.getAbstractFileByPath(path),
		isFolder: (path) => isFolder(app, path),
		normalizeMarkdownFilePath: (folder, fileName) => newNotePath(folder, fileName, ""),
	});
	const target = resolution.kind === "file" ? withNoteExtension(resolution.path) : PICKED_NOTE;
	return { text: describeCaptureTarget(target, heading), diagnostics };
}

/** A capture target's path as the run writes it: a Markdown note unless it names a canvas. */
function withNoteExtension(path: string): string {
	const bare = stripLeadingSlash(path);
	return MARKDOWN_FILE_EXTENSION_REGEX.test(bare) || CANVAS_FILE_EXTENSION_REGEX.test(bare) ? bare : `${bare}.md`;
}
