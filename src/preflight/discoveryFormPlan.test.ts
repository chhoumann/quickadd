import { createChoiceExecutor } from "../../tests/helpers/createChoiceExecutor";
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
import { buildDiscoveryFormPlan, resolveDiscoveryFieldRequirement, storeDiscoveryFormAnswers } from "./discoveryFormPlan";
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
	let templateContent: string;
	const app = {
		vault: {
			cachedRead: async () => templateContent,
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
		executor = { ...createChoiceExecutor(), execute: vi.fn(), variables: new Map() };
		selectedText = "";
		templateContent = "{{VALUE}} {{VALUE:shared}} {{VALUE:templateOnly}}";
	});

	it("separates note selection from repeated Capture answers and keeps shared fields visible", async () => {
		const plan = await buildDiscoveryFormPlan(app, plugin, executor,
			macro(nested(template, "note"), nested(capture, "first"), nested(capture, "second")));
		expect(plan).not.toBeNull();
		if (!plan) throw new Error("Expected discovery form");
		expect(plan.requirements.map((field) => field.id)).toEqual([
			"__qa.note.note", "shared", "templateOnly", "__qa.value.first", "__qa.value.second",
		]);
		expect(plan.config.visibleForNotes.get("templateOnly")).toEqual([{ noteId: "__qa.note.note", includeExisting: false }]);
		expect(plan.config.visibleForNotes.has("shared")).toBe(false);
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
			expect(executor.variables.has("shared")).toBe(false);
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

	it.each(["appendBottom", "appendTop", "overwrite"] as const)("prepares template inputs for %s without asking creation-only inputs", async (action) => {
		template.existingNoteAction = action;
		template.folder = { ...template.folder, enabled: true, folders: ["{{VALUE:folderOnly}}/{{VALUE:shared}}"] };
		template.dateOrigin = { kind: "ask" };
		const plan = await buildDiscoveryFormPlan(app, plugin, executor, template);
		if (!plan) throw new Error("Expected discovery form");
		const noteId = plan.config.notes[0].id;
		for (const id of ["shared", "templateOnly", QA_INTERNAL_DATE_ORIGIN]) {
			expect(plan.config.visibleForNotes.get(id), id).toEqual([{ noteId, includeExisting: true }]);
		}
		expect(plan.config.visibleForNotes.get("folderOnly")).toEqual([{ noteId, includeExisting: false }]);

		storeDiscoveryFormAnswers(executor, plan, new Map([
			["shared", "Ada"], ["templateOnly", "Ship Friday"],
			[QA_INTERNAL_DATE_ORIGIN, "@date:2026-09-07"], ["folderOnly", "Unused folder draft"],
		]), new Map([[noteId, { kind: "existing", path: "Projects/Atlas.md" }]]));
		await withPreparedChoiceInputs(executor, template.id, async () => {
			expect([...executor.variables]).toEqual(expect.arrayContaining([
				["shared", "Ada"], ["templateOnly", "Ship Friday"],
				[QA_INTERNAL_DATE_ORIGIN, "@date:2026-09-07"],
			]));
			expect(executor.variables.has("folderOnly")).toBe(false);
			expect(executor.variables.has("value")).toBe(false);
			expect(getPreparedTemplateNoteSelection(executor, template.id))
				.toEqual({ kind: "existing", path: "Projects/Atlas.md" });
		});
		expect(executor.variables.has("value")).toBe(false);
	});

	it("retains source-path answers when applying a dynamically selected template", async () => {
		template.existingNoteAction = "overwrite";
		template.templatePath = "Templates/{{VALUE:source}}.md";
		const plan = await buildDiscoveryFormPlan(app, plugin, executor, template);
		if (!plan) throw new Error("Expected discovery form");
		const noteId = plan.config.notes[0].id;
		expect(plan.config.visibleForNotes.get("source")).toEqual([{ noteId, includeExisting: true }]);
		storeDiscoveryFormAnswers(executor, plan, new Map([["source", "Project"]]),
			new Map([[noteId, { kind: "existing", path: "Projects/Atlas.md" }]]));
		await withPreparedChoiceInputs(executor, template.id, async () => {
			expect(executor.variables.get("source")).toBe("Project");
		});
	});

	it("uses only active template purposes to decide whether a shared field is optional and accepts images", async () => {
		template.existingNoteAction = "appendBottom";
		template.folder = { ...template.folder, enabled: true, folders: ["Archive/{{VALUE:detail}}"] };
		templateContent = "Description: {{VALUE:detail|optional}}";
		const plan = await buildDiscoveryFormPlan(app, plugin, executor, template);
		if (!plan) throw new Error("Expected discovery form");
		const noteId = plan.config.notes[0].id;
		const usages = plan.config.fieldUsages.get("detail");
		if (!usages) throw new Error("Expected shared field usages");
		expect(resolveDiscoveryFieldRequirement(usages, new Map([
			[noteId, { kind: "existing", path: "Projects/Atlas.md" }],
		]))).toMatchObject({ optional: true, pathContext: false });
		expect(resolveDiscoveryFieldRequirement(usages, new Map([
			[noteId, { kind: "create", title: "Borealis" }],
		]))).toMatchObject({ optional: false, pathContext: true });
	});

	it("does not let a skipped open-only Template restrict a shared Capture field", async () => {
		template.folder = { ...template.folder, enabled: true, folders: ["Archive/{{VALUE:detail}}"] };
		templateContent = "{{VALUE:detail}}";
		capture.format = { enabled: true, format: "{{VALUE:detail|optional}}" };
		const plan = await buildDiscoveryFormPlan(app, plugin, executor,
			macro(nested(template, "note"), nested(capture, "capture")));
		if (!plan) throw new Error("Expected discovery form");
		expect(plan.config.visibleForNotes.has("detail")).toBe(false);
		const usages = plan.config.fieldUsages.get("detail");
		if (!usages) throw new Error("Expected shared field usages");
		expect(resolveDiscoveryFieldRequirement(usages, new Map([
			["__qa.note.note", { kind: "existing", path: "Projects/Atlas.md" }],
		]))).toMatchObject({ optional: true, pathContext: false });
		expect(resolveDiscoveryFieldRequirement(usages, new Map([
			["__qa.note.note", { kind: "create", title: "Borealis" }],
		]))).toMatchObject({ optional: false, pathContext: true });
	});

	it("prepares creation-only answers per occurrence when the same Template creates and updates", async () => {
		template.existingNoteAction = "appendBottom";
		template.folder = { ...template.folder, enabled: true, folders: ["{{VALUE:folderOnly}}"] };
		const plan = await buildDiscoveryFormPlan(app, plugin, executor,
			macro(nested(template, "update"), nested(template, "create"), nested(capture, "capture")));
		if (!plan) throw new Error("Expected discovery form");
		storeDiscoveryFormAnswers(executor, plan, new Map([
			["shared", "Ada"], ["templateOnly", "Template text"], ["folderOnly", "Projects"],
			["__qa.value.capture", "Capture text"],
		]), new Map([
			["__qa.note.update", { kind: "existing", path: "Archive/Atlas.md" }],
			["__qa.note.create", { kind: "create", title: "Borealis" }],
		]));
		await withPreparedChoiceInputs(executor, "update", async () => {
			expect(executor.variables.get("shared")).toBe("Ada");
			expect(executor.variables.get("templateOnly")).toBe("Template text");
			expect(executor.variables.has("folderOnly")).toBe(false);
			expect(getPreparedTemplateNoteSelection(executor, template.id))
				.toEqual({ kind: "existing", path: "Archive/Atlas.md" });
		});
		await withPreparedChoiceInputs(executor, "create", async () => {
			expect(executor.variables.get("folderOnly")).toBe("Projects");
			expect(executor.variables.get("shared")).toBe("Ada");
			expect(getPreparedTemplateNoteSelection(executor, template.id))
				.toEqual({ kind: "create", title: "Borealis" });
		});
		await withPreparedChoiceInputs(executor, "capture", async () => {
			expect(executor.variables.get("shared")).toBe("Ada");
			expect(executor.variables.get("value")).toBe("Capture text");
			expect(executor.preparedInputs.active?.values.has("templateOnly")).toBe(false);
		});
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
