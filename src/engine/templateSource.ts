import type { App, TFile } from "obsidian";
import { refuse } from "../errors/RefusalError";
import type ITemplateChoice from "../types/choices/ITemplateChoice";
import { getTemplateFile } from "../utils/templateFolderUtils";
import { hasTemplatePathSyntax } from "../utils/templatePathSyntax";

const PICK_TEMPLATE = "Pick a template on the choice's page.";

/** The template file at a resolved template path, or a refusal saying it is not there. */
export function templateFileOrRefuse(app: App, resolvedTemplatePath: string, consequence: string): TFile {
	const file = getTemplateFile(app, resolvedTemplatePath);
	if (!file) throw refuse(`the template ${resolvedTemplatePath} does not exist`, consequence, PICK_TEMPLATE);
	return file;
}

/**
 * Refuses a Template run whose template is not picked or not there, before it
 * asks anything. A path with format syntax names its file only once its answers
 * are in, so the run checks that one when it resolves the path, still before the
 * note's title.
 */
export function checkTemplateSource(
	app: App,
	choice: Pick<ITemplateChoice, "templatePath" | "discoverExistingNotesBeforeCreate">,
): void {
	// A run that may open an existing note needs no template for that; the
	// creation path checks when it comes to creating.
	if (choice.discoverExistingNotesBeforeCreate) return;
	if (!choice.templatePath) throw refuse("no template is picked", "no note was created", PICK_TEMPLATE);
	if (!hasTemplatePathSyntax(choice.templatePath)) {
		templateFileOrRefuse(app, choice.templatePath, "no note was created");
	}
}
