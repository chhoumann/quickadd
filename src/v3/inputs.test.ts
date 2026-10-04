import { describe, expect, it } from "vitest";
import { CaptureChoice } from "../types/choices/CaptureChoice";
import type IChoice from "../types/choices/IChoice";
import { TemplateChoice } from "../types/choices/TemplateChoice";
import { listInputs } from "./inputs";
import { migrateChoice } from "./migrate";
import type { Action, Step } from "./model";

const actionOf = (choice: IChoice): Action => migrateChoice(choice).node as Action;

const noTemplates = async () => null;

describe("listInputs", () => {
	it("lists a Capture's inputs in the order the run meets them: target, then format", async () => {
		const capture = new CaptureChoice("Task");
		capture.captureTo = "Tasks/{{VALUE}}.md";
		capture.format = { enabled: true, format: "- {{VALUE:Title|optional}} due {{VDATE:Due,YYYY-MM-DD}}" };

		expect(await listInputs(actionOf(capture), noTemplates)).toEqual([
			{ name: "value", kind: "value", label: "Enter value", type: "text", optional: false, definedIn: { step: 0, where: "target" } },
			{ name: "Title", kind: "value", label: "Title", type: "text", optional: true, definedIn: { step: 0, where: "format" } },
			{ name: "Due", kind: "date", label: "Due", optional: false, definedIn: { step: 0, where: "format" } },
		]);
	});

	it("lists what a Template's file asks for as defined in that file", async () => {
		const template = new TemplateChoice("Meeting");
		template.templatePath = "Templates/Meeting.md";
		template.fileNameFormat = { enabled: true, format: "{{DATE}} {{VALUE:Topic}}" };
		const files: Record<string, string> = { "Templates/Meeting.md": "Guest: {{VALUE:Guest}}\nTopic: {{VALUE:Topic}}" };

		const inputs = await listInputs(actionOf(template), async (path) => files[path] ?? null);

		expect(inputs.map(({ name, definedIn }) => ({ name, definedIn }))).toEqual([
			{ name: "Topic", definedIn: { step: 0, where: "fileName" } },
			{ name: "Guest", definedIn: { step: 0, where: "template file", path: "Templates/Meeting.md" } },
		]);
	});

	it("reads what a global variable holds, from the settings it is given", async () => {
		const capture = new CaptureChoice("Project log");
		capture.captureTo = "Log.md";
		capture.format = { enabled: true, format: "{{GLOBAL_VAR:Projects}}" };
		const settings = { globalVariables: { Projects: "- {{VALUE:project}}" }, inputPrompt: "single-line" as const };

		const inputs = await listInputs(actionOf(capture), noTemplates, undefined, settings);

		expect(inputs.map(({ name, definedIn }) => ({ name, definedIn }))).toEqual([
			{ name: "project", definedIn: { step: 0, where: "format" } },
		]);
	});

	it("lists the note a Capture to a folder asks to pick", async () => {
		const capture = new CaptureChoice("Inbox");
		capture.id = "inbox";
		capture.captureTo = "Inbox/";

		const inputs = await listInputs(actionOf(capture), noTemplates);

		expect(inputs.map(({ kind, definedIn }) => ({ kind, where: definedIn.where }))).toEqual([
			{ kind: "pick", where: "target" },
			{ kind: "value", where: "format" },
		]);
	});

	it("marks what a script or an AI step before it may provide", async () => {
		const capture = new CaptureChoice("Log");
		capture.captureTo = "Log.md";
		capture.format = { enabled: true, format: "{{VALUE:mood}} {{VALUE:summary}}" };
		const write = actionOf(capture).steps[0];
		const early = { ...write, id: "early", format: { enabled: true, format: "{{VALUE:mood}}" } } as Step;
		const ai = { id: "ai", type: "ai", outputVariableName: "summary" } as Step;
		const script: Step = { id: "script", type: "runScript", path: "set.js", settings: {} };
		const late = { ...write, id: "late", format: { enabled: true, format: "{{VALUE:mood}} {{VALUE:summary}} {{VALUE:extra}}" } } as Step;

		const asked = async (steps: Step[]) =>
			(await listInputs({ ...actionOf(capture), steps }, noTemplates)).map(({ name, providedBy }) => ({ name, providedBy }));

		// mood is asked by the first step, before the script could set it.
		expect(await asked([early, ai, late])).toEqual([
			{ name: "mood", providedBy: undefined },
			{ name: "summary", providedBy: 1 },
			{ name: "extra", providedBy: undefined },
		]);
		expect(await asked([early, script, ai, late])).toEqual([
			{ name: "mood", providedBy: undefined },
			{ name: "summary", providedBy: 2 },
			{ name: "extra", providedBy: 1 },
		]);
	});
});
