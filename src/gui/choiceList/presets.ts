import { CaptureChoice } from "../../types/choices/CaptureChoice";
import type IChoice from "../../types/choices/IChoice";
import { MacroChoice } from "../../types/choices/MacroChoice";
import { TemplateChoice } from "../../types/choices/TemplateChoice";
import { normalizeAppendLinkOptions } from "../../types/linkPlacement";
import { AIAssistantCommand } from "../../types/macros/QuickCommands/AIAssistantCommand";
import { UserScript } from "../../types/macros/UserScript";

export type PresetGroupId = "add" | "create" | "automate";

/** The New choice menu's groups, in the order it shows them. */
export const PRESET_GROUPS: { id: PresetGroupId; label: string }[] = [
	{ id: "add", label: "Add to a note" },
	{ id: "create", label: "Create a note" },
	{ id: "automate", label: "Automate" },
];

/** What a preset may build from: the vault it is added to. */
export interface PresetContext {
	/** The folder whose notes a run offers as templates. */
	templateFolder: string;
}

/** A starting point offered by the "New choice" menu: a configured choice. */
export interface Preset {
	id: string;
	/** Short, sentence-case menu label. */
	label: string;
	/** One line shown next to the label on desktop. */
	description: string;
	/** Obsidian/lucide icon id. */
	iconId: string;
	group: PresetGroupId;
	/** Needs online features: hidden while they are disabled. */
	online?: boolean;
	/** The new choice's name, before it is made unique. */
	name: string;
	create(context: PresetContext): IChoice;
}

export const FOLDER_NAME = "New folder";

/** Today's daily note, as a capture target. */
export const DAILY_NOTE = "{{DAILY}}";

/** A capture under `heading` in `target`, which it creates, heading too, when missing. */
export function headingCapture(name: string, heading: string, target = DAILY_NOTE): CaptureChoice {
	const choice = new CaptureChoice(name);
	choice.captureTo = target;
	choice.createFileIfItDoesntExist = { enabled: true, createWithTemplate: false, template: "" };
	choice.insertAfter = {
		...choice.insertAfter,
		enabled: true,
		after: heading,
		insertAtEnd: true,
		createIfNotFound: true,
		createIfNotFoundLocation: "bottom",
	};
	return choice;
}

/** A timestamped line under `## Log`. */
export function logCapture(name: string, target = DAILY_NOTE): CaptureChoice {
	const choice = headingCapture(name, "## Log", target);
	choice.format = { enabled: true, format: "- {{TIME}} {{VALUE}}" };
	return choice;
}

/** A task under `## Tasks`; `dueDate` asks for an optional Tasks-plugin due date. */
export function taskCapture(name: string, target = DAILY_NOTE, dueDate = false): CaptureChoice {
	const choice = headingCapture(name, "## Tasks", target);
	choice.task = true;
	// The bracketed emoji is part of the date, so a skipped date leaves no 📅.
	if (dueDate) choice.format = { enabled: true, format: "{{VALUE}} {{VDATE:Due,[📅 ]YYYY-MM-DD|optional}}" };
	return choice;
}

/** A line at the bottom of `target`, or of a note picked each run when it is empty. */
export function bottomCapture(name: string, target = ""): CaptureChoice {
	const choice = new CaptureChoice(name);
	// `prepend` is v2's name for writing at the bottom of a note target.
	choice.prepend = true;
	if (target) {
		choice.captureTo = target;
		choice.createFileIfItDoesntExist = { enabled: true, createWithTemplate: false, template: "" };
	}
	return choice;
}

/** A new note that is linked on a new line where you are, then opened. */
export function linkedNoteTemplate(name: string): TemplateChoice {
	const choice = new TemplateChoice(name);
	choice.appendLink = normalizeAppendLinkOptions({
		enabled: true,
		placement: "newLine",
		requireActiveFile: false,
	});
	choice.openFile = true;
	return choice;
}

export const PRESETS: Preset[] = [
	{
		id: "log",
		group: "add",
		label: "Log with a timestamp",
		description: "A line under a heading in today's daily note.",
		iconId: "clock",
		name: "Log",
		create() {
			return logCapture(this.name);
		},
	},
	{
		id: "task",
		group: "add",
		label: "Add a task",
		description: "A task under a heading in today's daily note.",
		iconId: "check-square",
		name: "Task",
		create() {
			return taskCapture(this.name);
		},
	},
	{
		id: "addToNote",
		group: "add",
		label: "Add to a note you pick",
		description: "Pick the note each time, write at the bottom.",
		iconId: "pencil",
		name: "Add to note",
		create() {
			return bottomCapture(this.name);
		},
	},
	{
		id: "selection",
		group: "add",
		label: "Save the selection or clipboard",
		description: "The selected text, or a paste, at the bottom of a note you pick.",
		iconId: "clipboard-paste",
		name: "Save selection",
		create() {
			// No one placeholder is "the selection, else the clipboard": the
			// selection becomes the value, and without one the prompt takes a paste.
			const choice = bottomCapture(this.name);
			choice.useSelectionAsCaptureValue = true;
			return choice;
		},
	},
	{
		id: "property",
		group: "add",
		label: "Fill in a property",
		description: "Pick a property of the current note and set it.",
		iconId: "text-cursor-input",
		name: "Property",
		create() {
			const choice = new CaptureChoice(this.name);
			choice.captureToActiveFile = true;
			choice.propertyCapture = { property: { kind: "prompt" }, action: "set", createIfMissing: true };
			return choice;
		},
	},
	{
		id: "newNote",
		group: "create",
		label: "New note from a template",
		description: "Asks for a title, then creates the note.",
		iconId: "file-plus",
		name: "New note",
		create() {
			return new TemplateChoice(this.name);
		},
	},
	{
		id: "linkedNote",
		group: "create",
		label: "New note, linked from here",
		description: "Creates it, links it on a new line here, opens it.",
		iconId: "link",
		name: "Linked note",
		create() {
			return linkedNoteTemplate(this.name);
		},
	},
	{
		id: "typedNote",
		group: "create",
		label: "New note of a type",
		description: "Pick a template and a folder each time.",
		iconId: "layout-template",
		name: "Typed note",
		create({ templateFolder }) {
			const choice = new TemplateChoice(this.name);
			choice.templatePath = `{{FILE:${templateFolder}|path|label:Template}}`;
			choice.folder = { ...choice.folder, enabled: true, chooseWhenCreatingNote: true };
			choice.openFile = true;
			return choice;
		},
	},
	{
		id: "script",
		group: "automate",
		label: "Run a script",
		description: "A JavaScript file from your vault.",
		iconId: "code",
		name: "Script",
		create() {
			const choice = new MacroChoice(this.name);
			// No file yet: the builder that opens next asks for one.
			choice.macro.commands.push(new UserScript("Script", ""));
			return choice;
		},
	},
	{
		id: "sequence",
		group: "automate",
		label: "Run a sequence of steps",
		description: "Start empty and add steps.",
		iconId: "list-ordered",
		name: "Sequence",
		create() {
			return new MacroChoice(this.name);
		},
	},
	{
		id: "ai",
		group: "automate",
		online: true,
		label: "Ask AI",
		description: "Send a prompt to your AI provider.",
		iconId: "sparkles",
		name: "Ask AI",
		create() {
			const choice = new MacroChoice(this.name);
			choice.macro.commands.push(new AIAssistantCommand());
			return choice;
		},
	},
];

/**
 * A preset's choice as the New choice menu adds it: asking for all its inputs
 * on one page. A step a sequence adds stays unset and follows its sequence.
 */
export function createFromPreset(preset: Preset, context: PresetContext): IChoice {
	const choice = preset.create(context);
	choice.onePageInput = "always";
	return choice;
}

/** The presets to offer: all of them, less the online ones while those are off. */
export function availablePresets(disableOnlineFeatures: boolean): Preset[] {
	return disableOnlineFeatures ? PRESETS.filter((preset) => !preset.online) : PRESETS;
}
