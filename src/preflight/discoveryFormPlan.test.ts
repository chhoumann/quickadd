import { beforeEach, describe, expect, it, vi } from "vitest";
import type { App } from "obsidian";
import type { IChoiceExecutor } from "src/IChoiceExecutor";
import type QuickAdd from "src/main";
import { TemplateChoice } from "src/types/choices/TemplateChoice";
import { CaptureChoice } from "src/types/choices/CaptureChoice";
import type IMacroChoice from "src/types/choices/IMacroChoice";
import type IChoice from "src/types/choices/IChoice";
import type { ICommand } from "src/types/macros/ICommand";
import type { INestedChoiceCommand } from "src/types/macros/QuickCommands/INestedChoiceCommand";
import { CommandType } from "src/types/macros/CommandType";
import { QA_INTERNAL_DATE_ORIGIN } from "src/constants";
import { buildDiscoveryFormPlan, storeDiscoveryFormAnswers } from "./discoveryFormPlan";
import { getPreparedTemplateNoteSelection, withPreparedChoiceInputs } from "./preparedChoiceInputs";

vi.mock("src/utilityObsidian", () => ({
	getTemplateFile: (_app: App, path: string) => ({ path }),
	isFolder: () => false,
}));
vi.mock("src/logger/logManager", () => ({ log: { logMessage: vi.fn(), logWarning: vi.fn() } }));

function nested(choice: IChoice, id: string): INestedChoiceCommand {
	return { id, name: choice.name, type: CommandType.NestedChoice, choice };
}

function macro(...commands: ICommand[]): IMacroChoice {
	return {
		id: "macro", name: "Macro", type: "Macro", command: false, runOnStartup: false,
		macro: { id: "macro", name: "Macro", commands },
	};
}

describe("discovery form planning", () => {
	let template: TemplateChoice;
	let capture: CaptureChoice;
	let executor: IChoiceExecutor;
	let selectedText: string;
	const app = {
		vault: {
			cachedRead: async () => "{{VALUE}} {{VALUE:shared}} {{VALUE:templateOnly}}",
			getAbstractFileByPath: () => null,
		},
		metadataCache: { getFileCache: () => null },
		workspace: { getActiveViewOfType: () => ({ editor: { getSelection: () => selectedText } }) },
	} as unknown as App;
	const plugin = {
		settings: { inputPrompt: "single-line", globalVariables: {}, useSelectionAsCaptureValue: true },
		getChoiceById: () => null,
	} as unknown as QuickAdd;

	beforeEach(() => {
		template = new TemplateChoice("Note");
		template.templatePath = "Templates/Note.md";
		template.discoverExistingNotesBeforeCreate = true;
		capture = new CaptureChoice("Capture");
		capture.captureTo = "Inbox.md";
		capture.format = { enabled: true, format: "{{VALUE}} {{VALUE:shared}}" };
		executor = { execute: vi.fn(), variables: new Map() };
		selectedText = "";
	});

	it("separates note selection from repeated Capture answers and keeps shared fields visible", async () => {
		const plan = await buildDiscoveryFormPlan(app, plugin, executor,
			macro(nested(template, "note"), nested(capture, "first"), nested(capture, "second")));
		expect(plan).not.toBeNull();
		if (!plan) throw new Error("Expected discovery form");
		expect(plan.requirements.map((field) => field.id)).toEqual([
			"__qa.note.note", "shared", "templateOnly", "__qa.value.first", "__qa.value.second",
		]);
		expect(plan.config.visibleWhenCreating.get("templateOnly")).toEqual(["__qa.note.note"]);
		expect(plan.config.visibleWhenCreating.has("shared")).toBe(false);
		expect(plan.requirements.filter((field) => field.id.startsWith("__qa.value."))
			.map((field) => field.group?.id)).toEqual(["first", "second"]);

		storeDiscoveryFormAnswers(executor, plan, new Map([
			["shared", "Shared answer"], ["templateOnly", "Draft for creation"],
			["__qa.value.first", "First answer"], ["__qa.value.second", "Second answer"],
		]), new Map([["__qa.note.note", { kind: "existing", path: "Existing.md" }]]));
		expect(executor.variables.size).toBe(0);
		await withPreparedChoiceInputs(executor, "note", async () => {
			expect(getPreparedTemplateNoteSelection(executor, template.id))
				.toEqual({ kind: "existing", path: "Existing.md" });
			expect(executor.variables.has("templateOnly")).toBe(false);
		});
		const results: unknown[] = [];
		for (const id of ["first", "second"]) {
			await withPreparedChoiceInputs(executor, id, async () => {
				results.push(executor.variables.get("value"));
				expect(executor.variables.get("shared")).toBe("Shared answer");
			});
		}
		expect(results).toEqual(["First answer", "Second answer"]);
		expect(executor.variables.has("value")).toBe(false);
	});

	it("keeps discovery mode for a grouped suffix after an opted-out Template", async () => {
		template.onePageInput = "never";
		const initial = await buildDiscoveryFormPlan(app, plugin, executor,
			macro(nested(template, "note"), nested(capture, "first"), nested(capture, "second")));
		expect(initial?.requirements).toEqual([]);
		const suffix = await buildDiscoveryFormPlan(app, plugin, executor,
			macro(nested(capture, "first"), nested(capture, "second")));
		expect(suffix?.requirements.map((field) => field.id)).toEqual([
			"shared", "__qa.value.first", "__qa.value.second",
		]);
		expect(suffix?.config.notes).toEqual([]);
	});

	it("preserves ordinary macros and explicitly seeded titles", async () => {
		expect(await buildDiscoveryFormPlan(app, plugin, executor,
			macro(nested(capture, "first"), nested(capture, "second")))).toBeNull();
		executor.variables.set("value", "Explicit title");
		expect(await buildDiscoveryFormPlan(app, plugin, executor,
			macro(nested(template, "note"), nested(capture, "capture")))).toBeNull();
	});

	it("defaults Capture input from selection without using it as the note title", async () => {
		selectedText = "Selected capture text";
		const plan = await buildDiscoveryFormPlan(app, plugin, executor,
			macro(nested(template, "note"), nested(capture, "capture")));
		expect(plan?.requirements.find((field) => field.id === "__qa.value.capture")?.defaultValue)
			.toBe("Selected capture text");
		expect(plan?.requirements.find((field) => field.id === "__qa.note.note")?.defaultValue)
			.toBeUndefined();
		expect(executor.variables.has("value")).toBe(false);
	});

	it("prepares the macro's date before child inputs", async () => {
		const choice = macro(nested(template, "note"));
		choice.dateOrigin = { kind: "ask" };
		const plan = await buildDiscoveryFormPlan(app, plugin, executor, choice);
		if (!plan) throw new Error("Expected discovery form");
		expect(plan.requirements[0].id).toBe(QA_INTERNAL_DATE_ORIGIN);
		storeDiscoveryFormAnswers(executor, plan,
			new Map([[QA_INTERNAL_DATE_ORIGIN, "@date:2026-09-05"]]),
			new Map([["__qa.note.note", { kind: "create", title: "New note" }]]));
		await withPreparedChoiceInputs(executor, choice.id, async () => {
			expect(executor.variables.get(QA_INTERNAL_DATE_ORIGIN)).toBe("@date:2026-09-05");
		});
	});
});
