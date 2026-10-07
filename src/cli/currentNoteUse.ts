import type { App } from "obsidian";
import type IChoice from "../types/choices/IChoice";
import type ICaptureChoice from "../types/choices/ICaptureChoice";
import type ITemplateChoice from "../types/choices/ITemplateChoice";
import { SELECTED_REGEX } from "../constants";
import { CURRENT_FOLDER_TOKEN_REGEX, CURRENT_NOTE_TOKEN_REGEX } from "../formatters/helpers/currentFileTokens";
import { deriveFolderMode } from "../gui/ChoiceBuilder/folderMode";
import { normalizeAppendLinkOptions } from "../types/linkPlacement";
import { getTemplateFile } from "../utils/templateFolderUtils";

/** Whether a choice needs the current note: `required` fails without one, `optional` leaves something empty. */
export type CurrentNoteUse = "none" | "optional" | "required";

type Link = ReturnType<typeof normalizeAppendLinkOptions>;

/**
 * How a choice uses the current note, read from its settings with the rules
 * the engines enforce. A Template's file content is passed in, since reading it
 * needs the vault (see {@link describeCurrentNoteUse}). Macros and Multis are
 * `none`: QuickAdd cannot know what a script reads.
 */
export function currentNoteUse(choice: IChoice, templateContent = ""): CurrentNoteUse {
	if (choice.type === "Capture") return strongest(captureUses(choice as ICaptureChoice));
	if (choice.type === "Template") return strongest(templateUses(choice as ITemplateChoice, templateContent));
	return "none";
}

/** {@link currentNoteUse} with the Template's file read from the vault. */
export async function describeCurrentNoteUse(app: App, choice: IChoice): Promise<CurrentNoteUse> {
	const template = choice.type === "Template"
		? getTemplateFile(app, (choice as ITemplateChoice).templatePath ?? "")
		: null;
	return currentNoteUse(choice, template ? await app.vault.cachedRead(template) : "");
}

function captureUses(capture: ICaptureChoice): CurrentNoteUse[] {
	const link = normalizeAppendLinkOptions(capture.appendLink);
	const format = capture.format?.enabled ? capture.format.format : "{{VALUE}}";
	const property = capture.propertyCapture?.property;
	return [
		capture.captureToActiveFile ? "required" : "none",
		linkUse(link),
		tokenUse(format, "content", link),
		capture.captureToActiveFile ? "none" : tokenUse(capture.captureTo ?? "", "path", link),
		capture.insertAfter?.enabled && !capture.insertAfter.promptHeading ? tokenUse(capture.insertAfter.after, "location", link) : "none",
		capture.insertBefore?.enabled ? tokenUse(capture.insertBefore.before, "location", link) : "none",
		property?.kind === "named" ? tokenUse(property.format, "content", link) : "none",
		SELECTED_REGEX.test(format) ? "optional" : "none",
	];
}

function templateUses(template: ITemplateChoice, templateContent: string): CurrentNoteUse[] {
	const link = normalizeAppendLinkOptions(template.appendLink);
	// A list must not fail on one hand-edited choice, so read defensively.
	const folder = template.folder ?? { enabled: false, folders: [] };
	const fileName = template.fileNameFormat?.enabled ? template.fileNameFormat.format : "{{VALUE}}";
	return [
		deriveFolderMode(folder) === "active-file" ? "required" : "none",
		deriveFolderMode(folder) === "specified" ? tokenUse((folder.folders ?? []).join("\n"), "path", link) : "none",
		linkUse(link),
		tokenUse(fileName, "path", link),
		tokenUse(templateContent, "content", link),
		SELECTED_REGEX.test(templateContent) ? "optional" : "none",
	];
}

/** Append link into the current note: a specified destination file never reads it. */
function linkUse(link: Link): CurrentNoteUse {
	if (!link.enabled || link.destination.type !== "activeFile") return "none";
	return link.requireActiveFile ? "required" : "optional";
}

const FOLDER_TOKENS = new RegExp(CURRENT_FOLDER_TOKEN_REGEX.source, "gi");

/**
 * What `{{LINKCURRENT}}`, `{{LINKSECTION}}`, `{{FILENAMECURRENT}}` and
 * `{{FOLDERCURRENT}}` do without a current note depends on where the format is
 * used. In content they render empty when the append link is on and not
 * required, and fail otherwise. In a path (a file name, a capture target, a
 * folder) an empty token would retarget the write, so they always fail. A line
 * target (insert after or before) keeps `{{FOLDERCURRENT}}` literal.
 */
function tokenUse(format: string, context: "content" | "path" | "location", link: Link): CurrentNoteUse {
	const text = context === "location" ? format.replace(FOLDER_TOKENS, "") : format;
	if (!CURRENT_NOTE_TOKEN_REGEX.test(text)) return "none";
	if (context === "path") return "required";
	return link.enabled && !link.requireActiveFile ? "optional" : "required";
}

function strongest(uses: CurrentNoteUse[]): CurrentNoteUse {
	if (uses.includes("required")) return "required";
	return uses.includes("optional") ? "optional" : "none";
}
