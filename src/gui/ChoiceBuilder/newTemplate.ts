import { type App, Notice, type TFile } from "obsidian";
import { log } from "../../logger/logManager";
import { ensureParentFolders } from "../../utils/ensureParentFolders";
import { isCancellationError, toError } from "../../utils/errorUtils";
import { openFile } from "../../utils/fileOpening";
import { normalizeVaultPath } from "../../utils/pathUtils";
import { normalizeTemplateFolderPaths } from "../../utils/templateFolderUtils";
import GenericInputPrompt from "../GenericInputPrompt/GenericInputPrompt";

/** A new template: a heading the note's title fills in, and a line to write on. */
export const NEW_TEMPLATE_CONTENT = "# {{VALUE:Title}}\n\n";

/**
 * Where a new template goes: QuickAdd's first template folder, else the core
 * Templates plugin's folder, else Templates.
 */
export function newTemplateFolder(app: App, templateFolderPaths: unknown): string {
	const [first] = normalizeTemplateFolderPaths(templateFolderPaths);
	if (first) return first;
	// Not public API: read it as untrusted.
	const templates = app.internalPlugins?.plugins?.["templates"] as
		| { instance?: { options?: { folder?: unknown } } }
		| undefined;
	const core = templates?.instance?.options?.folder;
	return (typeof core === "string" && normalizeVaultPath(core)) || "Templates";
}

/**
 * Create `<folder>/<name>.md` as a new template. Null for an empty name, or
 * when that file exists: a new template never replaces one.
 */
export async function createTemplateFile(app: App, folder: string, name: string): Promise<TFile | null> {
	const base = normalizeVaultPath(name).replace(/\.md$/i, "");
	if (!base) return null;
	const path = `${folder}/${base}.md`;
	if (app.vault.getAbstractFileByPath(path)) {
		new Notice(`QuickAdd: ${path} already exists.`);
		return null;
	}
	await ensureParentFolders(app, path);
	return await app.vault.create(path, NEW_TEMPLATE_CONTENT);
}

/**
 * Ask for a name, create the template and open it in a new tab behind
 * settings. Returns its path, or null when none was made.
 */
export async function newTemplate(app: App, templateFolderPaths: unknown): Promise<string | null> {
	let name: string;
	try {
		name = await GenericInputPrompt.Prompt(app, "Template name");
	} catch (error) {
		if (!isCancellationError(error)) log.logError(toError(error, "Could not ask for a template name"));
		return null;
	}
	let file: TFile | null;
	try {
		file = await createTemplateFile(app, newTemplateFolder(app, templateFolderPaths), name);
	} catch (error) {
		log.logError(toError(error, "Could not create the template"));
		return null;
	}
	if (!file) return null;
	try {
		await openFile(app, file, { location: "tab", focus: false });
	} catch (error) {
		log.logError(toError(error, `Could not open ${file.path}`));
	}
	return file.path;
}
