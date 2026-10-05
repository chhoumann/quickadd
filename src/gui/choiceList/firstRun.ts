import type { App } from "obsidian";
import type { QuickAddSettings } from "../../settings";
import type IChoice from "../../types/choices/IChoice";
import { TemplateChoice } from "../../types/choices/TemplateChoice";
import { getPeriodicNoteSettings } from "../../utils/periodicNotes";
import { normalizeVaultPath } from "../../utils/pathUtils";
import { isPathWithinTemplateFolders, normalizeTemplateFolderPaths } from "../../utils/templateFolderUtils";
import {
	bottomCapture,
	DAILY_NOTE,
	headingCapture,
	linkedNoteTemplate,
	logCapture,
	taskCapture,
} from "./presets";

/** What the empty list's question builds from: the vault as it is. */
export interface VaultFacts {
	/** Daily notes or Periodic Notes has daily notes on, so `{{DAILY}}` resolves. */
	dailyNotes: boolean;
	/** The Tasks community plugin is on. */
	tasksPlugin: boolean;
	/** QuickAdd's first template folder, else the Templates core plugin's. */
	templateFolder: string | null;
	/** Markdown files in the template folder, or in Templates/ when none is set. */
	templates: string[];
}

export type JobId = "journal" | "tasks" | "meetings" | "reading" | "projects";

export interface Job {
	id: JobId;
	title: string;
	iconId: string;
}

/** The answers to "What do you do in Obsidian?", in the order they are offered. */
export const JOBS: Job[] = [
	{ id: "journal", title: "Keep a daily journal", iconId: "book-open" },
	{ id: "tasks", title: "Track tasks", iconId: "check-square" },
	{ id: "meetings", title: "Meeting and people notes", iconId: "users" },
	{ id: "reading", title: "Collect reading and ideas", iconId: "inbox" },
	{ id: "projects", title: "Run projects", iconId: "folder-kanban" },
];

export interface FirstRunPlan {
	choices: IChoice[];
	/** Files the choices need, created only where nothing exists yet. */
	files: { path: string; content: string }[];
}

const JOURNAL_FOLDER = "Journal";
const JOURNAL_NOTE = `${JOURNAL_FOLDER}/{{DATE:YYYY-MM-DD}}.md`;
export const DEFAULT_TEMPLATE_FOLDER = "Templates";

const MEETING_TEMPLATE = "# Meeting with {{VALUE:Who}}\n\n{{DATE}}\n\n## Notes\n\n";
const PROJECT_TEMPLATE = "# {{VALUE:Name}}\n\n## Goal\n\n## Next\n\n";

function record(value: unknown): Record<string, unknown> | undefined {
	return value && typeof value === "object" ? (value as Record<string, unknown>) : undefined;
}

/** QuickAdd's first template folder, else the Templates core plugin's. */
export function readTemplateFolder(app: App, settings: Pick<QuickAddSettings, "templateFolderPaths">): string | null {
	// Other plugins' internals: check every step before use.
	const coreTemplates = record(record(record(app.internalPlugins?.plugins?.["templates"])?.instance)?.options);
	const coreFolder = typeof coreTemplates?.folder === "string" ? normalizeVaultPath(coreTemplates.folder) : "";
	return normalizeTemplateFolderPaths(settings.templateFolderPaths)[0] ?? (coreFolder || null);
}

export function readVaultFacts(app: App, settings: Pick<QuickAddSettings, "templateFolderPaths">): VaultFacts {
	let dailyNotes = false;
	try {
		getPeriodicNoteSettings(app, "daily");
		dailyNotes = true;
	} catch {
		// Neither Daily notes nor Periodic Notes daily notes is on.
	}
	const templateFolder = readTemplateFolder(app, settings);
	const folder = templateFolder ?? DEFAULT_TEMPLATE_FOLDER;
	return {
		dailyNotes,
		tasksPlugin: Boolean(app.plugins?.plugins?.["obsidian-tasks-plugin"]),
		templateFolder,
		templates: app.vault
			.getMarkdownFiles()
			.map((file) => file.path)
			.filter((path) => isPathWithinTemplateFolders(path, [folder]))
			.sort(),
	};
}

function basename(path: string): string {
	return (path.split("/").pop() ?? path).replace(/\.md$/i, "");
}

/** The vault's template whose name contains `word`, or the one to create. */
function template(facts: VaultFacts, word: string, name: string, content: string) {
	const existing = facts.templates.find((path) => basename(path).toLowerCase().includes(word));
	if (existing) return { path: existing, file: null };
	const path = `${facts.templateFolder ?? DEFAULT_TEMPLATE_FOLDER}/${name}.md`;
	return { path, file: { path, content } };
}

function meetingTemplate(facts: VaultFacts) {
	return template(facts, "meeting", "Meeting", MEETING_TEMPLATE);
}

function projectTemplate(facts: VaultFacts) {
	return template(facts, "project", "Project", PROJECT_TEMPLATE);
}

/** One line under a job's title: what picking it adds. */
export function describeJob(id: JobId, facts: VaultFacts): string {
	const note = facts.dailyNotes ? "today's daily note" : `${JOURNAL_FOLDER}/`;
	switch (id) {
		case "journal":
			return `Log and Thought, in ${note}`;
		case "tasks":
			return `Task, in ${note}`;
		case "meetings":
			return `Meeting note, in Meetings/${meetingTemplate(facts).file ? ". Adds a Meeting template" : ""}`;
		case "reading":
			return "Inbox and Save link, in Inbox and Reading list";
		case "projects":
			return `Project, in Projects/${projectTemplate(facts).file ? ". Adds a Project template" : ""}`;
	}
}

function withIcon<T extends IChoice>(choice: T, iconId: string): T {
	// The outcome's icon, not the type's, so the list and launcher read by it.
	choice.icon = iconId;
	return choice;
}

/** `choice`, set to create `folder/fileName` from a template and open it. */
function fromTemplate(choice: TemplateChoice, templatePath: string, folder: string, fileName: string): TemplateChoice {
	choice.templatePath = templatePath;
	choice.fileNameFormat = { enabled: true, format: fileName };
	choice.folder = { ...choice.folder, enabled: true, folders: [folder] };
	choice.openFile = true;
	return choice;
}

/** The choices, and the files they need, for the jobs picked, in the order given. */
export function planFirstRun(jobs: JobId[], facts: VaultFacts): FirstRunPlan {
	const target = facts.dailyNotes ? DAILY_NOTE : JOURNAL_NOTE;
	const choices: IChoice[] = [];
	const files: FirstRunPlan["files"] = [];
	for (const job of jobs) {
		switch (job) {
			case "journal": {
				const thought = headingCapture("Thought", "## Thoughts", target);
				thought.format = { enabled: true, format: "- {{VALUE}}" };
				choices.push(withIcon(logCapture("Log", target), "clock"), withIcon(thought, "lightbulb"));
				break;
			}
			case "tasks":
				choices.push(withIcon(taskCapture("Task", target, facts.tasksPlugin), "check-square"));
				break;
			case "meetings": {
				const { path, file } = meetingTemplate(facts);
				if (file) files.push(file);
				const meeting = fromTemplate(new TemplateChoice("Meeting note"), path, "Meetings", "{{DATE}} {{VALUE:Topic}}");
				choices.push(withIcon(meeting, "users"));
				break;
			}
			case "reading": {
				const inbox = bottomCapture("Inbox", "Inbox.md");
				inbox.format = { enabled: true, format: "- {{VALUE}}" };
				const link = bottomCapture("Save link", "Reading list.md");
				link.task = true;
				choices.push(withIcon(inbox, "inbox"), withIcon(link, "bookmark"));
				break;
			}
			case "projects": {
				const { path, file } = projectTemplate(facts);
				if (file) files.push(file);
				const project = fromTemplate(linkedNoteTemplate("Project"), path, "Projects", "{{VALUE:Name}}");
				choices.push(withIcon(project, "folder-kanban"));
				break;
			}
		}
	}
	return { choices, files };
}
