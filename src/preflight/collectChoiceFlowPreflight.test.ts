import { describe, expect, it, vi } from "vitest";
import type { App } from "obsidian";
import { TFile } from "obsidian";
import type { IChoiceExecutor } from "../IChoiceExecutor";
import type ICaptureChoice from "../types/choices/ICaptureChoice";
import type IMacroChoice from "../types/choices/IMacroChoice";
import type ITemplateChoice from "../types/choices/ITemplateChoice";
import { CommandType } from "../types/macros/CommandType";
import { collectChoiceFlowPreflight } from "./collectChoiceFlowPreflight";

vi.mock("../utilityObsidian", () => ({
	getMarkdownFilesInFolder: vi.fn(() => []),
	getMarkdownFilesWithTag: vi.fn(() => []),
	getUserScript: vi.fn(),
	isFolder: vi.fn(() => false),
}));

function createExecutor(): IChoiceExecutor {
	return {
		execute: vi.fn(),
		variables: new Map<string, unknown>(),
	};
}

function createApp(templateContent = ""): App {
	const templateFile = new TFile();
	templateFile.path = "Templates/Note.md";
	templateFile.name = "Note.md";
	templateFile.basename = "Note";
	templateFile.extension = "md";

	return {
		plugins: { plugins: {} },
		vault: {
			getAbstractFileByPath: vi.fn((path: string) =>
				path === templateFile.path ? templateFile : null,
			),
			cachedRead: vi.fn().mockResolvedValue(templateContent),
		},
		workspace: {
			getActiveViewOfType: vi.fn(() => null),
		},
	} as unknown as App;
}

function createPlugin(choices: Array<IMacroChoice | ICaptureChoice | ITemplateChoice>) {
	const byId = new Map(choices.map((choice) => [choice.id, choice]));
	return {
		settings: {
			inputPrompt: "single-line",
			globalVariables: {},
			useSelectionAsCaptureValue: true,
			choices,
		},
		getChoiceById: vi.fn((id: string) => {
			const choice = byId.get(id);
			if (!choice) throw new Error(`Choice ${id} not found`);
			return choice;
		}),
	} as any;
}

function createCaptureChoice(): ICaptureChoice {
	return {
		id: "capture-choice",
		name: "Capture Project",
		type: "Capture",
		command: false,
		captureTo: "Inbox.md",
		captureToActiveFile: false,
		createFileIfItDoesntExist: {
			enabled: false,
			createWithTemplate: false,
			template: "",
		},
		format: { enabled: true, format: "Project: {{VALUE:project}}" },
		prepend: false,
		appendLink: false,
		task: false,
		insertAfter: {
			enabled: false,
			after: "",
			insertAtEnd: false,
			considerSubsections: false,
			createIfNotFound: false,
			createIfNotFoundLocation: "",
		},
		newLineCapture: {
			enabled: false,
			direction: "below",
		},
		openFile: false,
		fileOpening: {
			location: "tab",
			direction: "vertical",
			mode: "default",
			focus: true,
		},
	};
}

function createTemplateChoice(): ITemplateChoice {
	return {
		id: "template-choice",
		name: "Template Note",
		type: "Template",
		command: false,
		templatePath: "Templates/Note.md",
		folder: {
			enabled: false,
			folders: [],
			chooseWhenCreatingNote: false,
			createInSameFolderAsActiveFile: false,
			chooseFromSubfolders: false,
		},
		fileNameFormat: { enabled: false, format: "" },
		appendLink: false,
		openFile: false,
		fileOpening: {
			location: "tab",
			direction: "vertical",
			mode: "default",
			focus: true,
		},
		fileExistsBehavior: { kind: "prompt" },
	};
}

describe("collectChoiceFlowPreflight", () => {
	it("reuses requirement parsing for nested macro choices and emits flow diagnostics", async () => {
		const captureChoice = createCaptureChoice();
		const macroChoice: IMacroChoice = {
			id: "macro-choice",
			name: "Macro Flow",
			type: "Macro",
			command: false,
			runOnStartup: false,
			macro: {
				id: "macro",
				name: "Macro Flow",
				commands: [
					{
						id: "nested-command",
						name: "Run capture",
						type: CommandType.NestedChoice,
						choice: captureChoice,
					} as any,
				],
			},
		};
		const app = createApp();
		const plugin = createPlugin([macroChoice, captureChoice]);

		const result = await collectChoiceFlowPreflight(
			app,
			plugin,
			createExecutor(),
			macroChoice,
		);

		expect(result.requirements).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ id: "project" }),
			]),
		);
		expect(result.unresolvedRequirements.map((req) => req.id)).toContain(
			"project",
		);
		expect(result.choices.map((choice) => choice.id)).toEqual([
			"macro-choice",
			"capture-choice",
		]);
		expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toEqual(
			expect.arrayContaining([
				"flow-shared-context",
				"nested-choice-shares-context",
				"missing-required-inputs",
			]),
		);
	});

	it("emits integration diagnostics when Templater syntax is detected without Templater", async () => {
		const templateChoice = createTemplateChoice();
		const app = createApp("Created at <% tp.date.now() %>");
		const plugin = createPlugin([templateChoice]);

		const result = await collectChoiceFlowPreflight(
			app,
			plugin,
			createExecutor(),
			templateChoice,
		);

		expect(result.diagnostics).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					code: "templater-not-installed",
					severity: "info",
				}),
			]),
		);
	});
});
