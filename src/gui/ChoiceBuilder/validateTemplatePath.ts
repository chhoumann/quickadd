import type { App } from "obsidian";
import { getTemplateFile } from "../../utils/templateFolderUtils";
import { hasTemplatePathSyntax } from "../../utils/templatePathSyntax";

/**
 * Validates a template path field in the Template and Capture builders. It
 * resolves the path like the engine does at run time instead of requiring
 * suggestion-list membership, because a template outside the configured
 * folders still runs.
 */
export function validateTemplatePath(
	app: App,
	raw: string,
): true | string | { valid: true; message: string } {
	const value = raw.trim();
	if (!value) return true;
	// A path with format syntax (e.g. "Templates/{{value:type}} Template.md")
	// only resolves when the choice runs, so show a neutral hint rather than
	// flagging it "not found".
	if (hasTemplatePathSyntax(value)) {
		return { valid: true, message: "Contains format syntax — resolved at run time." };
	}
	return getTemplateFile(app, value) !== null || "Template not found";
}
