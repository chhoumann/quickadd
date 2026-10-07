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

/** What a formatted text becomes: note content, a path, a line target, or a property name. */
type FormatContext = "content" | "path" | "line" | "property";

/** A text the run formats, and what the formatted text becomes. */
export type Formatted = [text: string, context: FormatContext];

/** What the classification reads beyond the choice's own settings. */
export interface CurrentNoteUseContext {
	/**
	 * The text of every template the run formats, with what it becomes: a
	 * Template's file, a Capture's create-with-template file, and the files any
	 * formatted setting includes with `{{TEMPLATE:...}}`, which become what that
	 * setting becomes.
	 */
	templates: Formatted[];
	/**
	 * The global "Use selection as capture value" setting, which a Capture may
	 * override. A template's own `{{VALUE}}` prompt always takes the selection.
	 */
	selectionAsCaptureValue: boolean;
	/**
	 * Obsidian's "Default location for new notes" is "Same folder as current
	 * file", which a Template with its folder setting off follows.
	 */
	newNotesInCurrentFolder: boolean;
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
	// vault.getConfig is the de-facto (untyped) plugin API for Obsidian's settings.
	const vault = plugin.app.vault as App["vault"] & { getConfig?: (key: string) => unknown };
	return currentNoteUse(choice, {
		templates: await readTemplates(plugin.app, templatePaths(choice)),
		selectionAsCaptureValue: plugin.settings.useSelectionAsCaptureValue ?? true,
		newNotesInCurrentFolder: vault.getConfig?.("newFileLocation") === "current",
	});
}

/** The template files a choice formats, and the includes of its formatted settings, each with what it becomes. */
function templatePaths(choice: IChoice): Formatted[] {
	const creation = choice.type === "Capture" ? (choice as ICaptureChoice).createFileIfItDoesntExist : undefined;
	const own: Formatted[] = choice.type === "Template"
		? [[(choice as ITemplateChoice).templatePath ?? "", "content"]]
		: creation?.enabled && creation.createWithTemplate ? [[creation.template, "content"]] : [];
	return [...own, ...formattedSettings(choice).flatMap(([text, context]) => includes(text, context))];
}

function includes(text: string, context: FormatContext): Formatted[] {
	return [...collectTemplateIncludePaths(text)].map((path): Formatted => [path, context]);
}

/** The text of each template at `paths` and of every template they include, each read once per context. */
async function readTemplates(app: App, paths: Formatted[]): Promise<Formatted[]> {
	const queue = [...paths];
	const read = new Set<string>();
	const texts: Formatted[] = [];
	for (let next = queue.shift(); next !== undefined; next = queue.shift()) {
		const [path, context] = next;
		const file = getTemplateFile(app, path);
		if (!file || read.has(`${context}:${file.path}`)) continue;
		read.add(`${context}:${file.path}`);
		const text = await app.vault.cachedRead(file);
		texts.push([text, context]);
		queue.push(...includes(text, context));
	}
	return texts;
}

/** The settings a run formats, with what each becomes. */
function formattedSettings(choice: IChoice): Formatted[] {
	if (choice.type === "Capture") {
		const capture = choice as ICaptureChoice;
		const property = capture.propertyCapture?.property;
		return [
			[captureFormat(capture), "content"],
			[capture.captureToActiveFile ? "" : capture.captureTo ?? "", "path"],
			[capture.insertAfter?.enabled && !capture.insertAfter.promptHeading ? capture.insertAfter.after : "", "line"],
			[capture.insertBefore?.enabled ? capture.insertBefore.before : "", "line"],
			[property?.kind === "named" ? property.format : "", "property"],
		];
	}
	if (choice.type === "Template") {
		const template = choice as ITemplateChoice;
		const folder = templateFolder(template);
		return [
			[template.fileNameFormat?.enabled ? template.fileNameFormat.format : "{{VALUE}}", "path"],
			[deriveFolderMode(folder) === "specified" ? (folder.folders ?? []).join("\n") : "", "path"],
		];
	}
	return [];
}

function captureFormat(capture: ICaptureChoice): string {
	return capture.format?.enabled ? capture.format.format : "{{VALUE}}";
}

/** A list must not fail on one hand-edited choice, so the folder setting is read defensively. */
function templateFolder(template: ITemplateChoice): ITemplateChoice["folder"] {
	return template.folder ?? { enabled: false, folders: [] };
}

function captureUses(capture: ICaptureChoice, { templates, selectionAsCaptureValue }: CurrentNoteUseContext): CurrentNoteUse[] {
	const link = normalizeAppendLinkOptions(capture.appendLink);
	const formatted = [...formattedSettings(capture), ...templates];
	return [
		capture.captureToActiveFile ? "required" : "none",
		linkUse(link),
		...formatted.map(([text, context]) => tokenUse(text, context, link)),
		...formatted.map(([text]) => activeDefaultUse(text)),
		selectionUse(captureFormat(capture), capture.useSelectionAsCaptureValue ?? selectionAsCaptureValue),
		...templates.map(([text]) => selectionUse(text, true)),
	];
}

function templateUses(template: ITemplateChoice, { templates, newNotesInCurrentFolder }: CurrentNoteUseContext): CurrentNoteUse[] {
	const link = normalizeAppendLinkOptions(template.appendLink);
	const mode = deriveFolderMode(templateFolder(template));
	const formatted = [...formattedSettings(template), ...templates];
	return [
		mode === "active-file" || (mode === "obsidian-default" && newNotesInCurrentFolder) ? "required" : "none",
		linkUse(link),
		...formatted.map(([text, context]) => tokenUse(text, context, link)),
		...formatted.map(([text]) => activeDefaultUse(text)),
		...formatted.map(([text]) => selectionUse(text, true)),
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
function tokenUse(format: string, context: FormatContext, link: Link): CurrentNoteUse {
	const text = context === "line" ? format.replace(FOLDER_TOKENS, "") : format;
	if (!CURRENT_NOTE_TOKEN_REGEX.test(text)) return "none";
	return context === "content" && link.enabled && !link.requireActiveFile ? "optional" : "required";
}

const ACTIVE_DEFAULT_REGEX = /{{FIELD:[^}]*\|\s*default-from\s*:\s*active\s*(?:\||}})/i;

/** `{{FIELD:…|default-from:active}}` takes its default from the current note's properties. */
function activeDefaultUse(text: string): CurrentNoteUse {
	return ACTIVE_DEFAULT_REGEX.test(text) ? "optional" : "none";
}

/** `{{SELECTED}}`, and `{{VALUE}}` when the formatter fills it from the selection, are empty without a current note. */
function selectionUse(text: string, valueFromSelection: boolean): CurrentNoteUse {
	return SELECTED_REGEX.test(text) || (valueFromSelection && NAME_VALUE_REGEX.test(text)) ? "optional" : "none";
}

function strongest(uses: CurrentNoteUse[]): CurrentNoteUse {
	if (uses.includes("required")) return "required";
	return uses.includes("optional") ? "optional" : "none";
}
