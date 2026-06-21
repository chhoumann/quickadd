import { beforeEach, describe, expect, it, vi } from "vitest";
import type { App } from "obsidian";
import type { IChoiceExecutor } from "src/IChoiceExecutor";
import type ICaptureChoice from "src/types/choices/ICaptureChoice";
import type IMacroChoice from "src/types/choices/IMacroChoice";
import type ITemplateChoice from "src/types/choices/ITemplateChoice";
import { CommandType } from "src/types/macros/CommandType";
import type { IUserScript } from "src/types/macros/IUserScript";
import { QA_INTERNAL_CAPTURE_TARGET_FILE_PATH } from "src/constants";
import { collectChoiceRequirements } from "./collectChoiceRequirements";

const {
	getMarkdownFilesInFolderMock,
	getMarkdownFilesMatchingFilterMock,
	getMarkdownFilesWithTagMock,
	getMarkdownFilesWithPropertyMock,
	getUserScriptMock,
	getTemplateFileMock,
	isFolderMock,
	logWarningMock,
	logMessageMock,
} = vi.hoisted(() => ({
	getMarkdownFilesInFolderMock: vi.fn(() => []),
	getMarkdownFilesMatchingFilterMock: vi.fn(() => []),
	getMarkdownFilesWithTagMock: vi.fn(() => []),
	getMarkdownFilesWithPropertyMock: vi.fn(() => []),
	getUserScriptMock: vi.fn(),
	getTemplateFileMock: vi.fn((_app?: unknown, _path?: string) => null),
	isFolderMock: vi.fn(() => false),
	logWarningMock: vi.fn(),
	logMessageMock: vi.fn(),
}));

vi.mock("src/utilityObsidian", () => ({
	getMarkdownFilesInFolder: getMarkdownFilesInFolderMock,
	getMarkdownFilesMatchingFilter: getMarkdownFilesMatchingFilterMock,
	getMarkdownFilesWithTag: getMarkdownFilesWithTagMock,
	getMarkdownFilesWithProperty: getMarkdownFilesWithPropertyMock,
	getUserScript: getUserScriptMock,
	getTemplateFile: getTemplateFileMock,
	isFolder: isFolderMock,
}));

vi.mock("src/logger/logManager", () => ({
	log: {
		logWarning: logWarningMock,
		logMessage: logMessageMock,
	},
}));

function createMacroChoice(script: IUserScript): IMacroChoice {
	return {
		id: "macro-choice",
		name: "Macro Choice",
		type: "Macro",
		command: false,
		runOnStartup: false,
		macro: {
			id: "macro-choice",
			name: "Macro Choice",
			commands: [script],
		},
	};
}

function createCaptureChoice(captureTo: string): ICaptureChoice {
	return {
		id: "capture-choice",
		name: "Capture Choice",
		type: "Capture",
		command: false,
		captureTo,
		captureToActiveFile: false,
		createFileIfItDoesntExist: {
			enabled: false,
			createWithTemplate: false,
			template: "",
		},
		format: { enabled: false, format: "" },
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

describe("collectChoiceRequirements - template include scanning", () => {
	const templateBodies = new Map<string, string>();
	const cachedReadMock = vi.fn(
		async (file: { path: string }) => templateBodies.get(file.path) ?? "",
	);
	const app = {
		vault: {
			cachedRead: cachedReadMock,
		},
		metadataCache: {
			getFileCache: vi.fn(() => null),
		},
	} as unknown as App;
	const plugin = {
		settings: {
			inputPrompt: "single-line",
			globalVariables: {},
			useSelectionAsCaptureValue: true,
		},
	} as any;

	function createTemplateChoice(templatePath: string): ITemplateChoice {
		return {
			id: "template-choice",
			name: "Template Choice",
			type: "Template",
			command: false,
			templatePath,
			fileNameFormat: { enabled: false, format: "" },
			folder: {
				enabled: false,
				folders: [],
				chooseWhenCreatingNote: false,
				createInSameFolderAsActiveFile: false,
				chooseFromSubfolders: false,
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

	beforeEach(() => {
		templateBodies.clear();
		cachedReadMock.mockClear();
		getTemplateFileMock.mockReset();
		getTemplateFileMock.mockImplementation((_app: App, path: string) =>
			templateBodies.has(path) ? ({ path } as never) : null,
		);
	});

	it("collects requirements from TEMPLATE includes in Capture formats", async () => {
		templateBodies.set(
			"Templates/Capture Format.md",
			"Included value: {{VALUE:includedValue}}",
		);
		const choiceExecutor: IChoiceExecutor = {
			execute: vi.fn(),
			variables: new Map<string, unknown>(),
		};
		const captureChoice = {
			...createCaptureChoice("Inbox.md"),
			format: {
				enabled: true,
				format: "{{TEMPLATE:Templates/Capture Format.md}}",
			},
		} as ICaptureChoice;

		const requirements = await collectChoiceRequirements(
			app,
			plugin,
			choiceExecutor,
			captureChoice,
		);

		expect(requirements).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ id: "includedValue" }),
			]),
		);
		expect(cachedReadMock).toHaveBeenCalledWith(
			expect.objectContaining({ path: "Templates/Capture Format.md" }),
		);
	});

	it("does not recurse into TEMPLATE includes introduced by global variables", async () => {
		templateBodies.set(
			"Templates/From Global.md",
			"{{VALUE:fromGlobalTemplate}}",
		);
		const choiceExecutor: IChoiceExecutor = {
			execute: vi.fn(),
			variables: new Map<string, unknown>(),
		};
		const captureChoice = {
			...createCaptureChoice("Inbox.md"),
			format: {
				enabled: true,
				format: "{{GLOBAL_VAR:TemplateRef}}",
			},
		} as ICaptureChoice;

		const requirements = await collectChoiceRequirements(
			app,
			{
				settings: {
					...plugin.settings,
					globalVariables: {
						TemplateRef: "{{TEMPLATE:Templates/From Global.md}}",
					},
				},
			} as any,
			choiceExecutor,
			captureChoice,
		);

		expect(requirements).not.toEqual(
			expect.arrayContaining([
				expect.objectContaining({ id: "fromGlobalTemplate" }),
			]),
		);
		expect(cachedReadMock).not.toHaveBeenCalledWith(
			expect.objectContaining({ path: "Templates/From Global.md" }),
		);
	});

	it("still collects ordinary requirements introduced by global variables", async () => {
		const choiceExecutor: IChoiceExecutor = {
			execute: vi.fn(),
			variables: new Map<string, unknown>(),
		};
		const captureChoice = {
			...createCaptureChoice("Inbox.md"),
			format: {
				enabled: true,
				format: "{{GLOBAL_VAR:ValueRef}}",
			},
		} as ICaptureChoice;

		const requirements = await collectChoiceRequirements(
			app,
			{
				settings: {
					...plugin.settings,
					globalVariables: {
						ValueRef: "{{VALUE:fromGlobalValue}}",
					},
				},
			} as any,
			choiceExecutor,
			captureChoice,
		);

		expect(requirements).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ id: "fromGlobalValue" }),
			]),
		);
	});

	it("collects requirements from TEMPLATE includes in Capture targets", async () => {
		templateBodies.set(
			"Templates/Capture Target.md",
			"Inbox/{{VALUE:captureTargetName}}.md",
		);
		const choiceExecutor: IChoiceExecutor = {
			execute: vi.fn(),
			variables: new Map<string, unknown>(),
		};

		const requirements = await collectChoiceRequirements(
			app,
			plugin,
			choiceExecutor,
			createCaptureChoice("{{TEMPLATE:Templates/Capture Target.md}}"),
		);

		expect(requirements).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ id: "captureTargetName" }),
			]),
		);
	});

	it("collects requirements from TEMPLATE includes in Capture insert-after targets", async () => {
		templateBodies.set(
			"Templates/Heading.md",
			"## {{VALUE:insertAfterHeading}}",
		);
		const choiceExecutor: IChoiceExecutor = {
			execute: vi.fn(),
			variables: new Map<string, unknown>(),
		};
		const captureChoice = {
			...createCaptureChoice("Inbox.md"),
			insertAfter: {
				...createCaptureChoice("Inbox.md").insertAfter,
				enabled: true,
				after: "{{TEMPLATE:Templates/Heading.md}}",
			},
		} as ICaptureChoice;

		const requirements = await collectChoiceRequirements(
			app,
			plugin,
			choiceExecutor,
			captureChoice,
		);

		expect(requirements).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ id: "insertAfterHeading" }),
			]),
		);
	});

	it("collects requirements from TEMPLATE includes in Capture insert-before targets", async () => {
		templateBodies.set(
			"Templates/Before.md",
			"## {{VALUE:insertBeforeHeading}}",
		);
		const choiceExecutor: IChoiceExecutor = {
			execute: vi.fn(),
			variables: new Map<string, unknown>(),
		};
		const captureChoice = {
			...createCaptureChoice("Inbox.md"),
			insertBefore: {
				enabled: true,
				before: "{{TEMPLATE:Templates/Before.md}}",
				createIfNotFound: false,
				createIfNotFoundLocation: "top",
			},
		} as ICaptureChoice;

		const requirements = await collectChoiceRequirements(
			app,
			plugin,
			choiceExecutor,
			captureChoice,
		);

		expect(requirements).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ id: "insertBeforeHeading" }),
			]),
		);
	});

	it("collects requirements from TEMPLATE includes in Template file names", async () => {
		templateBodies.set("Templates/Source.md", "Body");
		templateBodies.set(
			"Templates/File Name.md",
			"{{VALUE:templateFileName}}",
		);
		const choiceExecutor: IChoiceExecutor = {
			execute: vi.fn(),
			variables: new Map<string, unknown>(),
		};
		const templateChoice = {
			...createTemplateChoice("Templates/Source.md"),
			fileNameFormat: {
				enabled: true,
				format: "{{TEMPLATE:Templates/File Name.md}}",
			},
		} as ITemplateChoice;

		const requirements = await collectChoiceRequirements(
			app,
			plugin,
			choiceExecutor,
			templateChoice,
		);

		expect(requirements).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ id: "templateFileName" }),
			]),
		);
	});

	it("recursively collects nested TEMPLATE includes in Capture formats", async () => {
		templateBodies.set(
			"Templates/Capture Outer.md",
			"Outer {{TEMPLATE:Templates/Capture Inner.md}}",
		);
		templateBodies.set(
			"Templates/Capture Inner.md",
			"Inner {{VALUE:nestedIncludedValue}}",
		);
		const choiceExecutor: IChoiceExecutor = {
			execute: vi.fn(),
			variables: new Map<string, unknown>(),
		};
		const captureChoice = {
			...createCaptureChoice("Inbox.md"),
			format: {
				enabled: true,
				format: "{{TEMPLATE:Templates/Capture Outer.md}}",
			},
		} as ICaptureChoice;

		const requirements = await collectChoiceRequirements(
			app,
			plugin,
			choiceExecutor,
			captureChoice,
		);

		expect(requirements).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ id: "nestedIncludedValue" }),
			]),
		);
	});

	it("does not collect requirements beyond the runtime TEMPLATE inclusion depth", async () => {
		for (let index = 0; index < 9; index++) {
			templateBodies.set(
				`Templates/T${index}.md`,
				`{{TEMPLATE:Templates/T${index + 1}.md}}`,
			);
		}
		templateBodies.set(
			"Templates/T9.md",
			"{{VALUE:atRuntimeLimit}} {{TEMPLATE:Templates/T10.md}}",
		);
		templateBodies.set("Templates/T10.md", "{{VALUE:tooDeep}}");
		const choiceExecutor: IChoiceExecutor = {
			execute: vi.fn(),
			variables: new Map<string, unknown>(),
		};
		const captureChoice = {
			...createCaptureChoice("Inbox.md"),
			format: {
				enabled: true,
				format: "{{TEMPLATE:Templates/T0.md}}",
			},
		} as ICaptureChoice;

		const requirements = await collectChoiceRequirements(
			app,
			plugin,
			choiceExecutor,
			captureChoice,
		);

		expect(requirements).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ id: "atRuntimeLimit" }),
			]),
		);
		expect(requirements).not.toEqual(
			expect.arrayContaining([expect.objectContaining({ id: "tooDeep" })]),
		);
		expect(cachedReadMock).not.toHaveBeenCalledWith(
			expect.objectContaining({ path: "Templates/T10.md" }),
		);
	});

	it("allows a template reached at max depth to be scanned again after the stack unwinds", async () => {
		templateBodies.set(
			"Templates/Root Deep.md",
			"{{TEMPLATE:Templates/Deep0.md}} {{TEMPLATE:Templates/Shared.md}}",
		);
		for (let index = 0; index < 8; index++) {
			templateBodies.set(
				`Templates/Deep${index}.md`,
				`{{TEMPLATE:Templates/Deep${index + 1}.md}}`,
			);
		}
		templateBodies.set("Templates/Deep8.md", "{{TEMPLATE:Templates/Shared.md}}");
		templateBodies.set("Templates/Shared.md", "{{TEMPLATE:Templates/Nested.md}}");
		templateBodies.set("Templates/Nested.md", "{{VALUE:sharedNestedValue}}");
		const choiceExecutor: IChoiceExecutor = {
			execute: vi.fn(),
			variables: new Map<string, unknown>(),
		};
		const captureChoice = {
			...createCaptureChoice("Inbox.md"),
			format: {
				enabled: true,
				format: "{{TEMPLATE:Templates/Root Deep.md}}",
			},
		} as ICaptureChoice;

		const requirements = await collectChoiceRequirements(
			app,
			plugin,
			choiceExecutor,
			captureChoice,
		);

		expect(requirements).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ id: "sharedNestedValue" }),
			]),
		);
		expect(cachedReadMock).toHaveBeenCalledWith(
			expect.objectContaining({ path: "Templates/Nested.md" }),
		);
	});

	it("collects requirements from Capture create-with-template literal bodies", async () => {
		templateBodies.set(
			"Templates/Create Body.md",
			"Created with {{VALUE:createBodyValue}}",
		);
		const choiceExecutor: IChoiceExecutor = {
			execute: vi.fn(),
			variables: new Map<string, unknown>(),
		};
		const captureChoice = {
			...createCaptureChoice("Inbox.md"),
			createFileIfItDoesntExist: {
				enabled: true,
				createWithTemplate: true,
				template: "Templates/Create Body.md",
			},
		} as ICaptureChoice;

		const requirements = await collectChoiceRequirements(
			app,
			plugin,
			choiceExecutor,
			captureChoice,
		);

		expect(requirements).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ id: "createBodyValue" }),
			]),
		);
	});

	it("keeps recursive TEMPLATE scanning for Template choices", async () => {
		templateBodies.set(
			"Templates/Outer.md",
			"Outer {{TEMPLATE:Templates/Inner.md}}",
		);
		templateBodies.set("Templates/Inner.md", "Inner {{VALUE:templateValue}}");
		const choiceExecutor: IChoiceExecutor = {
			execute: vi.fn(),
			variables: new Map<string, unknown>(),
		};

		const requirements = await collectChoiceRequirements(
			app,
			plugin,
			choiceExecutor,
			createTemplateChoice("Templates/Outer.md"),
		);

		expect(requirements).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ id: "templateValue" }),
			]),
		);
	});
});

describe("collectChoiceRequirements - macro script metadata", () => {
	const app = {} as App;
	const plugin = {} as any;
	const choiceExecutor: IChoiceExecutor = {
		execute: vi.fn(),
		variables: new Map<string, unknown>(),
	};

	const scriptCommand: IUserScript = {
		id: "script-1",
		name: "Script 1",
		type: CommandType.UserScript,
		path: "script.js",
		settings: {},
	};

	beforeEach(() => {
		getMarkdownFilesInFolderMock.mockReset();
		getMarkdownFilesMatchingFilterMock.mockReset();
		getMarkdownFilesWithTagMock.mockReset();
		getUserScriptMock.mockReset();
		isFolderMock.mockReset();
		logWarningMock.mockReset();
		getMarkdownFilesInFolderMock.mockReturnValue([]);
		getMarkdownFilesWithTagMock.mockReturnValue([]);
		isFolderMock.mockReturnValue(false);
	});

	it("reads quickadd.inputs from function exports", async () => {
		const exported = (() => {}) as ((...args: unknown[]) => unknown) & {
			quickadd?: unknown;
		};
		exported.quickadd = {
			inputs: [{ id: "project", type: "text", label: "Project" }],
		};
		getUserScriptMock.mockResolvedValue(exported);

		const requirements = await collectChoiceRequirements(
			app,
			plugin,
			choiceExecutor,
			createMacroChoice(scriptCommand),
		);

		expect(requirements).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					id: "project",
					type: "text",
					label: "Project",
					source: "script",
				}),
			]),
		);
	});

	it("reads quickadd.inputs from object exports", async () => {
		getUserScriptMock.mockResolvedValue({
			quickadd: {
				inputs: [{ id: "project", type: "text", label: "Project" }],
			},
		});

		const requirements = await collectChoiceRequirements(
			app,
			plugin,
			choiceExecutor,
			createMacroChoice(scriptCommand),
		);

		expect(requirements).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					id: "project",
					type: "text",
					label: "Project",
					source: "script",
				}),
			]),
		);
	});

	it("preserves script-declared number and slider inputs", async () => {
		getUserScriptMock.mockResolvedValue({
			quickadd: {
				inputs: [
					{
						id: "rating",
						type: "number",
						label: "Rating",
						numericConfig: { min: 1, max: 10, step: 1 },
					},
					{
						id: "confidence",
						type: "slider",
						label: "Confidence",
						defaultValue: "5",
						sliderConfig: { min: 0, max: 100, step: 5 },
					},
				],
			},
		});

		const requirements = await collectChoiceRequirements(
			app,
			plugin,
			choiceExecutor,
			createMacroChoice(scriptCommand),
		);

		expect(requirements).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					id: "rating",
					type: "number",
					numericConfig: { min: 1, max: 10, step: 1 },
					source: "script",
				}),
				expect.objectContaining({
					id: "confidence",
					type: "slider",
					defaultValue: "5",
					numericConfig: { min: 0, max: 100, step: 5 },
					sliderConfig: { min: 0, max: 100, step: 5 },
					source: "script",
				}),
			]),
		);
	});

	it("downgrades script-declared sliders with invalid config to number", async () => {
		getUserScriptMock.mockResolvedValue({
			quickadd: {
				inputs: [
					{
						id: "confidence",
						type: "slider",
						label: "Confidence",
						sliderConfig: { max: 100 },
					},
				],
			},
		});

		const requirements = await collectChoiceRequirements(
			app,
			plugin,
			choiceExecutor,
			createMacroChoice(scriptCommand),
		);

		expect(requirements).toEqual([
			expect.objectContaining({
				id: "confidence",
				type: "number",
				sliderConfig: undefined,
				source: "script",
			}),
		]);
	});

	it("ignores malformed input entries", async () => {
		const exported = (() => {}) as ((...args: unknown[]) => unknown) & {
			quickadd?: unknown;
		};
		exported.quickadd = {
			inputs: [{ id: "missingType" }, { type: "text" }, null],
		};
		getUserScriptMock.mockResolvedValue(exported);

		const requirements = await collectChoiceRequirements(
			app,
			plugin,
			choiceExecutor,
			createMacroChoice(scriptCommand),
		);

		expect(requirements).toEqual([]);
	});

	it("logs a warning when script metadata cannot be inspected", async () => {
		getUserScriptMock.mockRejectedValue(new Error("script load failed"));

		const requirements = await collectChoiceRequirements(
			app,
			plugin,
			choiceExecutor,
			createMacroChoice(scriptCommand),
		);

		expect(requirements).toEqual([]);
		expect(logWarningMock).toHaveBeenCalledWith(
			expect.stringContaining(
				"Preflight could not inspect user script 'script.js'",
			),
		);
	});
});

describe("collectChoiceRequirements - capture targets", () => {
	const getFileCacheMock = vi.fn();
	const app = {
		metadataCache: {
			getFileCache: getFileCacheMock,
		},
	} as unknown as App;
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

	beforeEach(() => {
		getMarkdownFilesInFolderMock.mockReset();
		getMarkdownFilesMatchingFilterMock.mockReset();
		getMarkdownFilesWithTagMock.mockReset();
		getMarkdownFilesWithPropertyMock.mockReset();
		isFolderMock.mockReset();
		logWarningMock.mockReset();
		getMarkdownFilesInFolderMock.mockReturnValue([]);
		getMarkdownFilesMatchingFilterMock.mockReturnValue([]);
		getMarkdownFilesWithTagMock.mockReturnValue([]);
		getMarkdownFilesWithPropertyMock.mockReturnValue([]);
		getFileCacheMock.mockReset();
		getFileCacheMock.mockImplementation((file: { path: string }) => {
			if (file.path === "Goals/Alpha.md") {
				return { frontmatter: { title: "Alpha Goal" } };
			}
			if (file.path === "Projects/Beta.md") {
				return { headings: [{ level: 1, heading: "Beta Heading" }] };
			}
			return null;
		});
	});

	it("normalizes capture folder paths ending in .md", async () => {
		isFolderMock.mockReturnValue(true);

		await collectChoiceRequirements(
			app,
			plugin,
			choiceExecutor,
			createCaptureChoice("Projects.md"),
		);

		expect(getMarkdownFilesInFolderMock).toHaveBeenCalledWith(
			app,
			"Projects/",
		);
	});

	it("does not force capture target dropdown for tokenized file paths", async () => {
		isFolderMock.mockReturnValue(false);

		const requirements = await collectChoiceRequirements(
			app,
			plugin,
			choiceExecutor,
			createCaptureChoice("Projects/{{VALUE}}.md"),
		);

		expect(getMarkdownFilesInFolderMock).not.toHaveBeenCalled();
		expect(
			requirements.some(
				(requirement) =>
					requirement.id === QA_INTERNAL_CAPTURE_TARGET_FILE_PATH,
			),
		).toBe(false);
	});

	it("forces the capture target dropdown for a property:field=value target (issue #466)", async () => {
		const requirements = await collectChoiceRequirements(
			app,
			plugin,
			choiceExecutor,
			createCaptureChoice("property:type=draft"),
		);

		expect(getMarkdownFilesWithPropertyMock).toHaveBeenCalledWith(
			app,
			"type",
			"draft",
			expect.any(Object),
		);
		expect(getMarkdownFilesWithTagMock).not.toHaveBeenCalled();
		expect(getMarkdownFilesInFolderMock).not.toHaveBeenCalled();
		expect(
			requirements.some(
				(requirement) =>
					requirement.id === QA_INTERNAL_CAPTURE_TARGET_FILE_PATH,
			),
		).toBe(true);
	});

	it("treats a value-less property target as presence mode (undefined value)", async () => {
		await collectChoiceRequirements(
			app,
			plugin,
			choiceExecutor,
			createCaptureChoice("property:type"),
		);

		expect(getMarkdownFilesWithPropertyMock).toHaveBeenCalledWith(
			app,
			"type",
			undefined,
			expect.any(Object),
		);
	});

	it("passes pipe filters through to the property query", async () => {
		await collectChoiceRequirements(
			app,
			plugin,
			choiceExecutor,
			createCaptureChoice("property:type=draft|folder:Notes"),
		);

		expect(getMarkdownFilesWithPropertyMock).toHaveBeenCalledWith(
			app,
			"type",
			"draft",
			expect.objectContaining({ folder: "Notes" }),
		);
	});

	it("forces the capture target dropdown for file filter targets", async () => {
		getMarkdownFilesMatchingFilterMock.mockReturnValue([
			{ path: "Goals/Alpha.md" } as never,
			{ path: "Projects/Beta.md" } as never,
		]);

		const requirements = await collectChoiceRequirements(
			app,
			plugin,
			choiceExecutor,
			createCaptureChoice("folder:Goals|folder:Projects|tag:active"),
		);

		expect(getMarkdownFilesMatchingFilterMock).toHaveBeenCalledWith(
			app,
			expect.objectContaining({
				folder: "Goals",
				folders: ["Goals", "Projects"],
				tags: ["active"],
			}),
		);
			const target = requirements.find(
				(requirement) =>
					requirement.id === QA_INTERNAL_CAPTURE_TARGET_FILE_PATH,
			);
			expect(target?.options).toEqual([
				"Goals/Alpha.md",
				"Projects/Beta.md",
			]);
			expect(target?.displayOptions).toEqual([
				"Alpha Goal (Alpha)",
				"Beta Heading (Beta)",
			]);
		});

	it("does not reinterpret multi-select capture target filters as tag targets", async () => {
		const requirements = await collectChoiceRequirements(
			app,
			plugin,
			choiceExecutor,
			createCaptureChoice("#work|multi"),
		);

		expect(getMarkdownFilesMatchingFilterMock).not.toHaveBeenCalled();
		expect(getMarkdownFilesWithTagMock).not.toHaveBeenCalled();
		expect(getMarkdownFilesInFolderMock).not.toHaveBeenCalled();
		expect(
			requirements.some(
				(requirement) =>
					requirement.id === QA_INTERNAL_CAPTURE_TARGET_FILE_PATH,
			),
		).toBe(false);
	});

	it("does not force the dropdown for a tokenized property value", async () => {
		const requirements = await collectChoiceRequirements(
			app,
			plugin,
			choiceExecutor,
			createCaptureChoice("property:type={{VALUE}}"),
		);

		expect(getMarkdownFilesWithPropertyMock).not.toHaveBeenCalled();
		expect(
			requirements.some(
				(requirement) =>
					requirement.id === QA_INTERNAL_CAPTURE_TARGET_FILE_PATH,
			),
		).toBe(false);
	});

	it("does not force the dropdown for a property target missing a field name", async () => {
		const requirements = await collectChoiceRequirements(
			app,
			plugin,
			choiceExecutor,
			createCaptureChoice("property:"),
		);

		expect(getMarkdownFilesWithPropertyMock).not.toHaveBeenCalled();
		expect(
			requirements.some(
				(requirement) =>
					requirement.id === QA_INTERNAL_CAPTURE_TARGET_FILE_PATH,
			),
		).toBe(false);
	});
});

describe("collectChoiceRequirements - template path format syntax (issue #620)", () => {
	const app = {} as App;
	const plugin = { settings: { inputPrompt: "single-line" } } as any;

	function createTemplateChoice(templatePath: string): ITemplateChoice {
		return {
			id: "template-choice",
			name: "Template Choice",
			type: "Template",
			command: false,
			templatePath,
			fileNameFormat: { enabled: false, format: "" },
			folder: {
				enabled: false,
				folders: [],
				chooseWhenCreatingNote: false,
				createInSameFolderAsActiveFile: false,
				chooseFromSubfolders: false,
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

	beforeEach(() => {
		getTemplateFileMock.mockReset();
		getTemplateFileMock.mockReturnValue(null);
		logMessageMock.mockReset();
	});

	it("collects a token in the template PATH itself and skips reading the (non-existent) body", async () => {
		const choiceExecutor: IChoiceExecutor = {
			execute: vi.fn(),
			variables: new Map<string, unknown>(),
		};

		const requirements = await collectChoiceRequirements(
			app,
			plugin,
			choiceExecutor,
			createTemplateChoice("Templates/{{VALUE:collectionName}} Template.md"),
		);

		expect(requirements).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ id: "collectionName" }),
			]),
		);
		// A dynamic path can't be resolved at preflight, so the body walk is
		// skipped — getTemplateFile must not be called for a tokenized path.
		expect(getTemplateFileMock).not.toHaveBeenCalled();
	});

	it("still walks the body for a literal (token-free) path", async () => {
		const choiceExecutor: IChoiceExecutor = {
			execute: vi.fn(),
			variables: new Map<string, unknown>(),
		};

		await collectChoiceRequirements(
			app,
			plugin,
			choiceExecutor,
			createTemplateChoice("Templates/Note.md"),
		);

		expect(getTemplateFileMock).toHaveBeenCalled();
	});

	it("collects a token in a Capture create-with-template path", async () => {
		const choiceExecutor: IChoiceExecutor = {
			execute: vi.fn(),
			variables: new Map<string, unknown>(),
		};

		const captureChoice = {
			...createCaptureChoice("Inbox.md"),
			createFileIfItDoesntExist: {
				enabled: true,
				createWithTemplate: true,
				template: "Templates/{{VALUE:kind}} Template.md",
			},
		} as ICaptureChoice;

		const requirements = await collectChoiceRequirements(
			app,
			{ settings: { inputPrompt: "single-line" } } as any,
			choiceExecutor,
			captureChoice,
		);

		expect(requirements).toEqual(
			expect.arrayContaining([expect.objectContaining({ id: "kind" })]),
		);
		// Dynamic path → body not pre-read.
		expect(getTemplateFileMock).not.toHaveBeenCalled();
	});
});
