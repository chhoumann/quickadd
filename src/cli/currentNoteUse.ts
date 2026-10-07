import type { App } from "obsidian";
import type QuickAdd from "../main";
import type IChoice from "../types/choices/IChoice";
import type ICaptureChoice from "../types/choices/ICaptureChoice";
import type ITemplateChoice from "../types/choices/ITemplateChoice";
import { NAME_VALUE_REGEX, SELECTED_REGEX } from "../constants";
import { CURRENT_FOLDER_TOKEN_REGEX, CURRENT_NOTE_TOKEN_REGEX } from "../formatters/helpers/currentFileTokens";
import { deriveFolderMode } from "../gui/ChoiceBuilder/folderMode";
import { normalizeAppendLinkOptions } from "../types/linkPlacement";
import { getTemplateFile } from "../utils/templateFolderUtils";
import { collectTemplateIncludePaths } from "../utils/templateIncludes";

/** Whether a choice needs the current note: `required` fails without one, `optional` leaves something empty. */
export type CurrentNoteUse = "none" | "optional" | "required";

/** What the classification reads beyond the choice's own settings. */
export interface CurrentNoteUseContext {
	/**
	 * The text of every template the run formats: a Template's file, a Capture's
	 * create-with-template file, and the files they include with `{{TEMPLATE:...}}`.
	 */
	templates: string[];
	/**
	 * The global "Use selection as capture value" setting, which a Capture may
	 * override. A template's own `{{VALUE}}` prompt always takes the selection.
	 */
	selectionAsCaptureValue: boolean;
}

type Link = ReturnType<typeof normalizeAppendLinkOptions>;

/**
 * How a choice uses the current note, read from its settings with the rules
 * the engines enforce. The vault reads are passed in (see
 * {@link describeCurrentNoteUse}). Macros and Multis are `none`: QuickAdd
 * cannot know what a script reads.
 */
export function currentNoteUse(choice: IChoice, context: CurrentNoteUseContext): CurrentNoteUse {
	if (choice.type === "Capture") return strongest(captureUses(choice as ICaptureChoice, context));
	if (choice.type === "Template") return strongest(templateUses(choice as ITemplateChoice, context));
	return "none";
}

/** {@link currentNoteUse} with the templates the run formats read from the vault. */
export async function describeCurrentNoteUse(plugin: QuickAdd, choice: IChoice): Promise<CurrentNoteUse> {
	return currentNoteUse(choice, {
		templates: await readTemplates(plugin.app, templatePaths(choice)),
		selectionAsCaptureValue: plugin.settings.useSelectionAsCaptureValue ?? true,
	});
}

/** The template files a choice formats, and the includes of its own format. */
function templatePaths(choice: IChoice): string[] {
	if (choice.type === "Template") return [(choice as ITemplateChoice).templatePath ?? ""];
	if (choice.type !== "Capture") return [];
	const capture = choice as ICaptureChoice;
	const creation = capture.createFileIfItDoesntExist;
	return [
		...(creation?.enabled && creation.createWithTemplate ? [creation.template] : []),
		...collectTemplateIncludePaths(capture.format?.enabled ? capture.format.format : ""),
	];
}

/** The text of each template at `paths` and of every template they include, each read once. */
async function readTemplates(app: App, paths: string[]): Promise<string[]> {
	const queue = [...paths];
	const read = new Set<string>();
	const texts: string[] = [];
	for (let path = queue.shift(); path !== undefined; path = queue.shift()) {
		const file = getTemplateFile(app, path);
		if (!file || read.has(file.path)) continue;
		read.add(file.path);
		const text = await app.vault.cachedRead(file);
		texts.push(text);
		queue.push(...collectTemplateIncludePaths(text));
	}
	return texts;
}

function captureUses(capture: ICaptureChoice, { templates, selectionAsCaptureValue }: CurrentNoteUseContext): CurrentNoteUse[] {
	const link = normalizeAppendLinkOptions(capture.appendLink);
	const format = capture.format?.enabled ? capture.format.format : "{{VALUE}}";
	const property = capture.propertyCapture?.property;
	const contents = [format, ...templates];
	return [
		capture.captureToActiveFile ? "required" : "none",
		linkUse(link),
		...contents.map((text) => tokenUse(text, "content", link)),
		capture.captureToActiveFile ? "none" : tokenUse(capture.captureTo ?? "", "path", link),
		capture.insertAfter?.enabled && !capture.insertAfter.promptHeading ? tokenUse(capture.insertAfter.after, "line", link) : "none",
		capture.insertBefore?.enabled ? tokenUse(capture.insertBefore.before, "line", link) : "none",
		property?.kind === "named" ? tokenUse(property.format, "property", link) : "none",
		selectionUse(format, capture.useSelectionAsCaptureValue ?? selectionAsCaptureValue),
		...templates.map((text) => selectionUse(text, true)),
	];
}

function templateUses(template: ITemplateChoice, { templates }: CurrentNoteUseContext): CurrentNoteUse[] {
	const link = normalizeAppendLinkOptions(template.appendLink);
	// A list must not fail on one hand-edited choice, so read defensively.
	const folder = template.folder ?? { enabled: false, folders: [] };
	const fileName = template.fileNameFormat?.enabled ? template.fileNameFormat.format : "{{VALUE}}";
	return [
		deriveFolderMode(folder) === "active-file" ? "required" : "none",
		deriveFolderMode(folder) === "specified" ? tokenUse((folder.folders ?? []).join("\n"), "path", link) : "none",
		linkUse(link),
		tokenUse(fileName, "path", link),
		...templates.map((text) => tokenUse(text, "content", link)),
		...[fileName, ...templates].map((text) => selectionUse(text, true)),
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
 * required, and fail otherwise. Anywhere else (a path, a line target, a
 * property name) an empty token leaves nothing usable: a retargeted write, a
 * blank or unmatched line, a nameless property. A line target keeps
 * `{{FOLDERCURRENT}}` literal, so that token alone needs no note there.
 */
function tokenUse(format: string, context: "content" | "path" | "line" | "property", link: Link): CurrentNoteUse {
	const text = context === "line" ? format.replace(FOLDER_TOKENS, "") : format;
	if (!CURRENT_NOTE_TOKEN_REGEX.test(text)) return "none";
	return context === "content" && link.enabled && !link.requireActiveFile ? "optional" : "required";
}

/** `{{SELECTED}}`, and `{{VALUE}}` when the formatter fills it from the selection, are empty without a current note. */
function selectionUse(text: string, valueFromSelection: boolean): CurrentNoteUse {
	return SELECTED_REGEX.test(text) || (valueFromSelection && NAME_VALUE_REGEX.test(text)) ? "optional" : "none";
}

function strongest(uses: CurrentNoteUse[]): CurrentNoteUse {
	if (uses.includes("required")) return "required";
	return uses.includes("optional") ? "optional" : "none";
}
