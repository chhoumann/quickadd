import { describe, expect, it, vi } from "vitest";
import { TFile, type App } from "obsidian";
import type { IChoiceExecutor } from "src/IChoiceExecutor";
import type ITemplateChoice from "src/types/choices/ITemplateChoice";
import { collectChoiceRequirements } from "./collectChoiceRequirements";
import { runOnePagePreflight } from "./runOnePagePreflight";

let modalResult: Record<string, string> = {};

vi.mock("./OnePageInputModal", () => ({
	OnePageInputModal: class {
		waitForClose = Promise.resolve(modalResult);
		constructor(
			_app: App,
			_requirements: unknown,
			_variables: Map<string, unknown>,
			computePreview?: (values: Record<string, string>) => Promise<unknown>,
		) {
			void computePreview?.({ project: "Preview Project" });
		}
	},
}));

vi.mock("src/quickAddSettingsTab", () => ({
	QuickAddSettingsTab: class {},
}));

vi.mock("src/main", () => ({
	__esModule: true,
	default: class QuickAddMock {},
}));

vi.mock("obsidian-dataview", () => ({
	__esModule: true,
	getAPI: vi.fn().mockReturnValue(null),
}));

vi.mock("src/utilityObsidian", async (importOriginal) => {
	const actual = (await importOriginal()) as Record<string, unknown>;
	return {
		...actual,
		getMarkdownFilesInFolder: vi.fn(() => []),
		getMarkdownFilesWithTag: vi.fn(() => []),
		getUserScript: vi.fn(),
		isFolder: vi.fn(() => false),
	};
});

function createTemplateChoice(): ITemplateChoice {
	return {
		id: "template-choice-id",
		name: "Template Choice",
		type: "Template",
		command: false,
		templatePath: "Templates/Safe.md",
		folder: {
			enabled: false,
			folders: [],
			chooseWhenCreatingNote: false,
			createInSameFolderAsActiveFile: false,
			chooseFromSubfolders: false,
		},
		fileNameFormat: {
			enabled: true,
			format: "{{VALUE:project}}",
		},
		appendLink: false,
		openFile: false,
		fileOpening: {
			location: "tab",
			direction: "vertical",
			mode: "default",
			focus: true,
		},
		fileExistsBehavior: { kind: "prompt" },
	} as ITemplateChoice;
}

function createApp() {
	const template = new TFile();
	template.path = "Templates/Safe.md";
	template.name = "Safe.md";
	template.basename = "Safe";
	template.extension = "md";

	return {
		workspace: {
			getActiveViewOfType: vi.fn().mockReturnValue(null),
			getActiveFile: vi.fn().mockReturnValue(null),
		},
		vault: {
			getAbstractFileByPath: vi.fn((path: string) =>
				path === "Templates/Safe.md" ? template : null,
			),
			cachedRead: vi.fn(
				async () =>
					"{{VALUE:project}} {{MACRO:ShouldNotRun}} ```js quickadd\napp.vault.create('bad.md', 'bad')\n```",
			),
			create: vi.fn(),
			modify: vi.fn(),
		},
		commands: {
			executeCommandById: vi.fn(),
		},
	} as unknown as App & {
		vault: {
			getAbstractFileByPath: ReturnType<typeof vi.fn>;
			cachedRead: ReturnType<typeof vi.fn>;
			create: ReturnType<typeof vi.fn>;
			modify: ReturnType<typeof vi.fn>;
		};
		commands: { executeCommandById: ReturnType<typeof vi.fn> };
	};
}

describe("preflight runtime safety", () => {
	it("collects and previews without runtime side effects", async () => {
		modalResult = { project: "Submitted Project" };
		const app = createApp();
		const plugin = {
			settings: {
				inputPrompt: "single-line",
				globalVariables: {},
				useSelectionAsCaptureValue: true,
			},
		} as any;
		const choiceExecutor: IChoiceExecutor = {
			execute: vi.fn(),
			variables: new Map<string, unknown>(),
		};
		const choice = createTemplateChoice();

		const requirements = await collectChoiceRequirements(
			app,
			plugin,
			choiceExecutor,
			choice,
		);
		const prompted = await runOnePagePreflight(
			app,
			plugin,
			choiceExecutor,
			choice,
		);

		expect(requirements.map((requirement) => requirement.id)).toContain(
			"project",
		);
		expect(prompted).toBe(true);
		expect(app.vault.cachedRead).toHaveBeenCalled();
		expect(choiceExecutor.execute).not.toHaveBeenCalled();
		expect(app.commands.executeCommandById).not.toHaveBeenCalled();
		expect(app.vault.create).not.toHaveBeenCalled();
		expect(app.vault.modify).not.toHaveBeenCalled();
	});
});
