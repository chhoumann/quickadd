import { CaptureChoice } from "../../types/choices/CaptureChoice";
import type IChoice from "../../types/choices/IChoice";
import { MacroChoice } from "../../types/choices/MacroChoice";
import { TemplateChoice } from "../../types/choices/TemplateChoice";
import { normalizeAppendLinkOptions } from "../../types/linkPlacement";

/** A starting point offered by the "New choice" menu: a configured choice. */
export interface Preset {
	id: string;
	/** Short, sentence-case menu label. */
	label: string;
	/** One line shown next to the label on desktop. */
	description: string;
	/** Obsidian/lucide icon id. */
	iconId: string;
	/** The new choice's name, before it is made unique. */
	name: string;
	create(): IChoice;
}

export const FOLDER_NAME = "New folder";

function dailyNoteCapture(name: string, heading: string): CaptureChoice {
	const choice = new CaptureChoice(name);
	choice.captureTo = "{{DAILY}}";
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

export const PRESETS: Preset[] = [
	{
		id: "log",
		label: "Log with a timestamp",
		description: "A line under a heading in today's daily note.",
		iconId: "clock",
		name: "Log",
		create() {
			const choice = dailyNoteCapture(this.name, "## Log");
			choice.format = { enabled: true, format: "- {{TIME}} {{VALUE}}" };
			return choice;
		},
	},
	{
		id: "addToNote",
		label: "Add to a note",
		description: "Pick the note each time, write at the bottom.",
		iconId: "pencil",
		name: "Add to note",
		create() {
			const choice = new CaptureChoice(this.name);
			// `prepend` is v2's name for writing at the bottom of a note target.
			choice.prepend = true;
			return choice;
		},
	},
	{
		id: "task",
		label: "Add a task",
		description: "A task under a heading in today's daily note.",
		iconId: "check-square",
		name: "Task",
		create() {
			const choice = dailyNoteCapture(this.name, "## Tasks");
			choice.task = true;
			return choice;
		},
	},
	{
		id: "newNote",
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
		label: "New note, linked from here",
		description: "Creates it, links it on a new line here, opens it.",
		iconId: "link",
		name: "Linked note",
		create() {
			const choice = new TemplateChoice(this.name);
			choice.appendLink = normalizeAppendLinkOptions({
				enabled: true,
				placement: "newLine",
				requireActiveFile: false,
			});
			choice.openFile = true;
			return choice;
		},
	},
	{
		id: "sequence",
		label: "Run a sequence of steps",
		description: "Start empty and add steps.",
		iconId: "list-ordered",
		name: "Sequence",
		create() {
			return new MacroChoice(this.name);
		},
	},
];
