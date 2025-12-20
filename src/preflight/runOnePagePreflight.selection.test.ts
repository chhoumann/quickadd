import { beforeEach, describe, expect, it, vi } from "vitest";
import type { App } from "obsidian";
import { runOnePagePreflight } from "./runOnePagePreflight";
import type ICaptureChoice from "../types/choices/ICaptureChoice";
import type { IChoiceExecutor } from "../IChoiceExecutor";

const { modalOpenMock } = vi.hoisted(() => ({
	modalOpenMock: vi.fn(),
}));

let modalResult: Record<string, string> = {};

vi.mock("./OnePageInputModal", () => ({
	OnePageInputModal: class {
		waitForClose = Promise.resolve(modalResult);
		constructor(...args: unknown[]) {
			modalOpenMock(...args);
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

vi.mock("src/utilityObsidian", () => ({
	getMarkdownFilesInFolder: vi.fn(() => []),
	getMarkdownFilesWithTag: vi.fn(() => []),
	getUserScript: vi.fn(),
	isFolder: vi.fn(() => false),
}));

const createApp = (selection: string | null) =>
	({
		workspace: {
			getActiveViewOfType: vi.fn().mockReturnValue(
				selection === null
					? null
					: {
							editor: {
								getSelection: () => selection,
							},
						},
			),
		},
	} as unknown as App);

const createChoice = (): ICaptureChoice => ({
	id: "capture-choice-id",
	name: "Capture Choice",
	type: "Capture",
	command: false,
	captureTo: "Inbox.md",
	captureToActiveFile: true,
	createFileIfItDoesntExist: {
		enabled: false,
		createWithTemplate: false,
		template: "",
	},
	format: { enabled: true, format: "{{VALUE}}" },
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
});

const createExecutor = (): IChoiceExecutor => ({
	execute: vi.fn(),
	variables: new Map<string, unknown>(),
});

describe("runOnePagePreflight selection-as-value", () => {
	beforeEach(() => {
		modalOpenMock.mockClear();
		modalResult = {};
	});

	it("prefills {{VALUE}} from selection when enabled", async () => {
		const choice = createChoice();
		const executor = createExecutor();
		const plugin = {
			settings: {
				inputPrompt: "single-line",
				globalVariables: {},
				useSelectionAsCaptureValue: true,
			},
		} as any;

		const result = await runOnePagePreflight(
			createApp("Selected text"),
			plugin,
			executor,
			choice,
		);

		expect(result).toBe(false);
		expect(executor.variables.get("value")).toBe("Selected text");
		expect(modalOpenMock).not.toHaveBeenCalled();
	});

	it("does not prefill when selection usage is disabled", async () => {
		const choice = createChoice();
		const executor = createExecutor();
		const plugin = {
			settings: {
				inputPrompt: "single-line",
				globalVariables: {},
				useSelectionAsCaptureValue: false,
			},
		} as any;
		modalResult = { value: "Manual" };

		const result = await runOnePagePreflight(
			createApp("Selected text"),
			plugin,
			executor,
			choice,
		);

		expect(result).toBe(true);
		expect(executor.variables.get("value")).toBe("Manual");
		expect(modalOpenMock).toHaveBeenCalledTimes(1);
	});
});
