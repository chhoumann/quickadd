import type { App } from "obsidian";
import { describe, expect, it } from "vitest";
import type IChoice from "../../types/choices/IChoice";
import type ICaptureChoice from "../../types/choices/ICaptureChoice";
import type ITemplateChoice from "../../types/choices/ITemplateChoice";
import { summarizeChoice } from "../../v3/choiceSummary";
import { migrateChoice } from "../../v3/migrate";
import { describeJob, JOBS, type JobId, planFirstRun, readVaultFacts, type VaultFacts } from "./firstRun";

const FACTS: VaultFacts = { dailyNotes: true, tasksPlugin: false, templateFolder: null, templates: [] };
const ALL_JOBS = JOBS.map((job) => job.id);

function lines(choices: IChoice[]): string[] {
	return choices.map((choice) => `${choice.name} (${choice.icon}): ${summarizeChoice(choice, choices)}`);
}

describe("planFirstRun", () => {
	it("writes to today's daily note when daily notes are on", () => {
		const { choices, files } = planFirstRun(ALL_JOBS, FACTS);
		expect(lines(choices)).toEqual([
			"Log (clock): Adds a line under ## Log in today's daily note",
			"Thought (lightbulb): Adds a line under ## Thoughts in today's daily note",
			"Task (check-square): Adds a task under ## Tasks in today's daily note",
			"Meeting note (users): Creates Meetings/{date} {Topic} from Meeting, opens it",
			"Inbox (inbox): Adds a line at the bottom of Inbox",
			"Save link (bookmark): Adds a task at the bottom of Reading list",
			"Project (folder-kanban): Creates Projects/{Name} from Project, links it here, opens it",
		]);
		expect(files.map((file) => file.path)).toEqual(["Templates/Meeting.md", "Templates/Project.md"]);
	});

	it("writes to a dated note in Journal/, made on first use, when daily notes are off", () => {
		const { choices } = planFirstRun(["journal", "tasks"], { ...FACTS, dailyNotes: false });
		expect(lines(choices)).toEqual([
			"Log (clock): Adds a line under ## Log in Journal/{date}",
			"Thought (lightbulb): Adds a line under ## Thoughts in Journal/{date}",
			"Task (check-square): Adds a task under ## Tasks in Journal/{date}",
		]);
		for (const choice of choices as ICaptureChoice[]) {
			expect(choice.captureTo).toBe("Journal/{{DATE:YYYY-MM-DD}}.md");
			expect(choice.createFileIfItDoesntExist.enabled).toBe(true);
		}
		expect(describeJob("journal", { ...FACTS, dailyNotes: false })).toBe("Log and Thought, in Journal/");
		expect(describeJob("journal", FACTS)).toBe("Log and Thought, in today's daily note");
	});

	it("asks for a Tasks-plugin due date only when the Tasks plugin is on", () => {
		const [plain] = planFirstRun(["tasks"], FACTS).choices as ICaptureChoice[];
		const [tasks] = planFirstRun(["tasks"], { ...FACTS, tasksPlugin: true }).choices as ICaptureChoice[];
		expect(plain.task).toBe(true);
		expect(plain.format.enabled).toBe(false);
		expect(tasks.task).toBe(true);
		expect(tasks.format).toEqual({ enabled: true, format: "{{VALUE}} {{VDATE:Due,[📅 ]YYYY-MM-DD|optional}}" });
	});

	it("uses a meeting template the vault has, and plans none", () => {
		const facts = { ...FACTS, templateFolder: "Meta", templates: ["Meta/Daily.md", "Meta/Team Meeting.md"] };
		const { choices, files } = planFirstRun(["meetings"], facts);
		expect((choices[0] as ITemplateChoice).templatePath).toBe("Meta/Team Meeting.md");
		expect(files).toEqual([]);
		expect(describeJob("meetings", facts)).toBe("Meeting note, in Meetings/");
	});

	it("plans a meeting template in the template folder when the vault has none", () => {
		const facts = { ...FACTS, templateFolder: "Meta", templates: ["Meta/Daily.md"] };
		const { choices, files } = planFirstRun(["meetings"], facts);
		expect((choices[0] as ITemplateChoice).templatePath).toBe("Meta/Meeting.md");
		expect(files).toEqual([{ path: "Meta/Meeting.md", content: expect.stringContaining("# Meeting with {{VALUE:Who}}") }]);
		expect(describeJob("meetings", facts)).toBe("Meeting note, in Meetings/. Adds a Meeting template");
	});

	it("plans choices that ask for their inputs on one page", () => {
		for (const dailyNotes of [true, false]) {
			const { choices } = planFirstRun(ALL_JOBS, { ...FACTS, dailyNotes });
			expect(choices.map((choice) => choice.onePageInput)).toEqual(choices.map(() => "always"));
		}
	});

	it("gives the choices in the order of the jobs", () => {
		const names = (jobs: JobId[]) => planFirstRun(jobs, FACTS).choices.map((choice) => choice.name);
		expect(names(["projects", "journal"])).toEqual(["Project", "Log", "Thought"]);
		expect(names(["journal", "projects"])).toEqual(["Log", "Thought", "Project"]);
	});

	it("plans choices that migrate to actions without dropping or misreading anything", () => {
		for (const dailyNotes of [true, false]) {
			for (const choice of planFirstRun(ALL_JOBS, { ...FACTS, dailyNotes, tasksPlugin: true }).choices) {
				expect(migrateChoice(choice).notes, choice.name).toEqual([]);
			}
		}
	});
});

describe("readVaultFacts", () => {
	function fakeApp(templatesFolder: unknown, files: string[]): App {
		return {
			internalPlugins: {
				plugins: {
					"daily-notes": { enabled: false, instance: { options: { folder: "Daily" } } },
					templates: { enabled: true, instance: { options: { folder: templatesFolder } } },
				},
			},
			plugins: { plugins: { "obsidian-tasks-plugin": {} } },
			vault: { getMarkdownFiles: () => files.map((path) => ({ path })) },
		} as unknown as App;
	}

	it("reads daily notes off, the Tasks plugin on, and the core Templates folder", () => {
		const app = fakeApp("/Meta/Templates/", ["Notes/Meeting.md", "Meta/Templates/Meeting.md", "Meta/Templates/Book.md"]);
		expect(readVaultFacts(app, { templateFolderPaths: [] })).toEqual({
			dailyNotes: false,
			tasksPlugin: true,
			templateFolder: "Meta/Templates",
			templates: ["Meta/Templates/Book.md", "Meta/Templates/Meeting.md"],
		});
	});

	it("prefers QuickAdd's template folder, and looks in Templates/ when none is set", () => {
		const files = ["Templates/Meeting.md", "QA/Project.md"];
		expect(readVaultFacts(fakeApp("Meta", files), { templateFolderPaths: ["QA/"] })).toMatchObject({
			templateFolder: "QA",
			templates: ["QA/Project.md"],
		});
		expect(readVaultFacts(fakeApp(42, files), { templateFolderPaths: [] })).toMatchObject({
			templateFolder: null,
			templates: ["Templates/Meeting.md"],
		});
	});
});
