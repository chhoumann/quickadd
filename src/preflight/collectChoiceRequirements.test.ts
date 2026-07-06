import { beforeEach, describe, expect, it, vi } from "vitest";
import { TFile, TFolder, type App } from "obsidian";
import type { IChoiceExecutor } from "src/IChoiceExecutor";
import type ICaptureChoice from "src/types/choices/ICaptureChoice";
import type IMacroChoice from "src/types/choices/IMacroChoice";
import type ITemplateChoice from "src/types/choices/ITemplateChoice";
import { CommandType } from "src/types/macros/CommandType";
import type { IUserScript } from "src/types/macros/IUserScript";
import { QA_INTERNAL_CAPTURE_TARGET_FILE_PATH } from "src/constants";
import {
	collectChoiceRequirements,
	getUnresolvedRequirements,
} from "./collectChoiceRequirements";

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

function enableCaptureTargetCreation(choice: ICaptureChoice): ICaptureChoice {
	return {
		...choice,
		createFileIfItDoesntExist: {
			enabled: true,
			createWithTemplate: false,
			template: "",
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

	// The walk was guarded only by the per-PATH cycle stack, so a template
	// reachable through many distinct paths was re-scanned once per path - a
	// dense layered DAG fans out as branching^depth (3^6 = 729 reads here;
	// ~1M at 4×10), freezing the UI. The cross-branch memo makes the walk
	// linear in distinct templates while still collecting every requirement.
	it("scans a dense template DAG once per template, not once per path", async () => {
		const LAYERS = 6;
		const WIDTH = 3;
		const refsTo = (layer: number) =>
			Array.from(
				{ length: WIDTH },
				(_, i) => `{{TEMPLATE:Templates/L${layer}-${i}.md}}`,
			).join(" ");
		for (let layer = 0; layer < LAYERS; layer++) {
			for (let i = 0; i < WIDTH; i++) {
				const body =
					layer === LAYERS - 1
						? "leaf {{VALUE:leafValue}}"
						: refsTo(layer + 1);
				templateBodies.set(`Templates/L${layer}-${i}.md`, body);
			}
		}
		templateBodies.set("Templates/Root.md", refsTo(0));
		const choiceExecutor: IChoiceExecutor = {
			execute: vi.fn(),
			variables: new Map<string, unknown>(),
		};

		const requirements = await collectChoiceRequirements(
			app,
			plugin,
			choiceExecutor,
			createTemplateChoice("Templates/Root.md"),
		);

		// Completeness: the deepest layer's requirement is still collected.
		expect(requirements).toEqual(
			expect.arrayContaining([expect.objectContaining({ id: "leafValue" })]),
		);
		// One read per distinct template (root + 18), not 3^6 per-path reads.
		expect(cachedReadMock.mock.calls.length).toBeLessThan(2 * LAYERS * WIDTH);
	});

	it("re-scans a template met again at a shallower depth (memo must not truncate)", async () => {
		// Chain T1→…→T10 exhausts the inclusion depth cap, so T10's child T11 is
		// NOT scanned on that path. The root also references T10 directly; the
		// depth-aware memo must re-scan it there so T11's requirement surfaces -
		// a naive "already seen" set would silently drop it.
		for (let i = 1; i < 10; i++) {
			templateBodies.set(
				`Templates/T${i}.md`,
				`{{TEMPLATE:Templates/T${i + 1}.md}}`,
			);
		}
		templateBodies.set("Templates/T10.md", "{{TEMPLATE:Templates/T11.md}}");
		templateBodies.set("Templates/T11.md", "deep {{VALUE:deepEleven}}");
		templateBodies.set(
			"Templates/Root.md",
			"{{TEMPLATE:Templates/T1.md}} {{TEMPLATE:Templates/T10.md}}",
		);
		const choiceExecutor: IChoiceExecutor = {
			execute: vi.fn(),
			variables: new Map<string, unknown>(),
		};

		const requirements = await collectChoiceRequirements(
			app,
			plugin,
			choiceExecutor,
			createTemplateChoice("Templates/Root.md"),
		);

		expect(requirements).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ id: "deepEleven" }),
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

	// Loading a user script to read quickadd.inputs EXECUTES its module body
	// (getUserScript runs the CommonJS wrapper). The collector must cache the
	// loaded module in the caller's preloadedUserScripts map - and reuse an
	// existing entry - so a single trigger never runs a script's top-level
	// side effects twice (introspection + MacroChoiceEngine execution).
	it("caches loaded modules in preloadedUserScripts and reuses existing entries", async () => {
		const exported = {
			quickadd: {
				inputs: [{ id: "project", type: "text", label: "Project" }],
			},
		};
		getUserScriptMock.mockResolvedValue(exported);
		const preloadedUserScripts = new Map<string, unknown>();

		await collectChoiceRequirements(
			app,
			plugin,
			choiceExecutor,
			createMacroChoice(scriptCommand),
			{ preloadedUserScripts },
		);

		expect(getUserScriptMock).toHaveBeenCalledTimes(1);
		expect(preloadedUserScripts.get("script.js")).toBe(exported);

		// A second collection pass (e.g. CLI collect followed by the one-page
		// preflight) must reuse the cached module, not execute it again.
		const requirements = await collectChoiceRequirements(
			app,
			plugin,
			choiceExecutor,
			createMacroChoice(scriptCommand),
			{ preloadedUserScripts },
		);

		expect(getUserScriptMock).toHaveBeenCalledTimes(1);
		expect(requirements).toEqual(
			expect.arrayContaining([expect.objectContaining({ id: "project" })]),
		);
	});

	// getUserScript returns the `::`-member-DRILLED export, so the cache key
	// must include the drill: two commands sharing a path but drilling
	// different members hold different functions with different inputs, and
	// caching by path alone made the second command reuse the first member's
	// export (its inputs were never collected, and at runtime the wrong
	// function could be consumed).
	it("keys the preload cache by member drill, not just path", async () => {
		const fooExport = {
			quickadd: { inputs: [{ id: "fooInput", type: "text", label: "Foo" }] },
		};
		const barExport = {
			quickadd: { inputs: [{ id: "barInput", type: "text", label: "Bar" }] },
		};
		getUserScriptMock
			.mockResolvedValueOnce(fooExport)
			.mockResolvedValueOnce(barExport);
		const preloadedUserScripts = new Map<string, unknown>();

		const macroChoice = createMacroChoice(scriptCommand);
		macroChoice.macro.commands = [
			{ ...scriptCommand, name: "Script 1::foo" },
			{ ...scriptCommand, id: "script-2", name: "Script 1::bar" },
		];

		const requirements = await collectChoiceRequirements(
			app,
			plugin,
			choiceExecutor,
			macroChoice,
			{ preloadedUserScripts },
		);

		expect(getUserScriptMock).toHaveBeenCalledTimes(2);
		expect(preloadedUserScripts.get("script.js::foo")).toBe(fooExport);
		expect(preloadedUserScripts.get("script.js::bar")).toBe(barExport);
		expect(requirements).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ id: "fooInput" }),
				expect.objectContaining({ id: "barInput" }),
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
	const getAbstractFileByPathMock = vi.fn();
	const app = {
		vault: {
			getAbstractFileByPath: getAbstractFileByPathMock,
		},
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
		getAbstractFileByPathMock.mockReset();
		getAbstractFileByPathMock.mockReturnValue(null);
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

	it("treats a definite .md target as a file even when a same-named folder exists", async () => {
		// A `.md` (or `.canvas`) extension is a definite file - exactly how the
		// write-path resolver (resolveCaptureTarget) and the docs ("a value ending
		// in a supported file extension ... targets that file path directly")
		// behave. So even with a colliding folder `Projects`, no runtime file pick
		// is required: the folder is never enumerated and no capture-target
		// requirement is emitted. (Regression guard for the #1448 follow-up: a
		// definite-file target must not be misrouted to a folder scope, which would
		// both spuriously prompt AND honour an injected __qa.captureTargetFilePath.)
		isFolderMock.mockReturnValue(true);

		const requirements = await collectChoiceRequirements(
			app,
			plugin,
			choiceExecutor,
			createCaptureChoice("Projects.md"),
		);

		expect(getMarkdownFilesInFolderMock).not.toHaveBeenCalled();
		expect(
			requirements.some(
				(requirement) =>
					requirement.id === QA_INTERNAL_CAPTURE_TARGET_FILE_PATH,
			),
		).toBe(false);
	});

	it("treats a bare name as a file when both the folder and a same-named note exist", async () => {
		// resolveCaptureTarget disambiguates `Projects` (folder `Projects/` AND note
		// `Projects.md` both exist) to the note. The collector must agree: no folder
		// enumeration, no capture-target requirement - otherwise it would prompt for
		// a pick AND let the engine honour an injected pick for a target the write
		// path resolves to a definite file.
		isFolderMock.mockReturnValue(true);
		getAbstractFileByPathMock.mockImplementation((path: string) =>
			path === "Projects.md"
				? Object.assign(new TFile(), { path })
				: null,
		);

		const requirements = await collectChoiceRequirements(
			app,
			plugin,
			choiceExecutor,
			createCaptureChoice("Projects"),
		);

		expect(getMarkdownFilesInFolderMock).not.toHaveBeenCalled();
		expect(
			requirements.some(
				(requirement) =>
					requirement.id === QA_INTERNAL_CAPTURE_TARGET_FILE_PATH,
			),
		).toBe(false);
	});

	it("still forces the dropdown when a same-named FOLDER (not a note) shares the X.md name", async () => {
		// A folder named `Projects.md` is NOT a note, so it must not suppress the
		// folder scope for bare `Projects` - otherwise the run resolves to the file
		// path `Projects.md`, which is itself a folder, and the write fails.
		isFolderMock.mockReturnValue(true);
		getAbstractFileByPathMock.mockImplementation((path: string) =>
			path === "Projects.md"
				? Object.assign(new TFolder(), { path })
				: null,
		);

		const requirements = await collectChoiceRequirements(
			app,
			plugin,
			choiceExecutor,
			createCaptureChoice("Projects"),
		);

		expect(getMarkdownFilesInFolderMock).toHaveBeenCalledWith(app, "Projects/");
		expect(
			requirements.some(
				(requirement) =>
					requirement.id === QA_INTERNAL_CAPTURE_TARGET_FILE_PATH,
			),
		).toBe(true);
	});

	it("forces the capture target dropdown for a bare folder name with no same-named note", async () => {
		// Folder exists but NO `Projects.md` - a genuine folder scope, so the pick
		// requirement IS emitted (regression guard that the same-name-note probe did
		// not over-suppress the legitimate folder picker).
		isFolderMock.mockReturnValue(true);
		getAbstractFileByPathMock.mockReturnValue(null);

		const requirements = await collectChoiceRequirements(
			app,
			plugin,
			choiceExecutor,
			createCaptureChoice("Projects"),
		);

		expect(getMarkdownFilesInFolderMock).toHaveBeenCalledWith(app, "Projects/");
		expect(
			requirements.some(
				(requirement) =>
					requirement.id === QA_INTERNAL_CAPTURE_TARGET_FILE_PATH,
			),
		).toBe(true);
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

	it("leaves empty create-enabled capture target scopes to the runtime picker", async () => {
		const requirements = await collectChoiceRequirements(
			app,
			plugin,
			choiceExecutor,
			enableCaptureTargetCreation(
				createCaptureChoice("folder:Goals|tag:active"),
			),
		);

		const target = requirements.find(
			(requirement) =>
				requirement.id === QA_INTERNAL_CAPTURE_TARGET_FILE_PATH,
		);
		expect(target).toMatchObject({
			type: "file-picker",
			runtimeOnly: true,
			options: [],
			displayOptions: [],
			placeholder: "Type a new note name in the capture target picker",
		});
	});

	it("allows a CLI-provided target path to satisfy an empty create-enabled scope", async () => {
		const requirements = await collectChoiceRequirements(
			app,
			plugin,
			choiceExecutor,
			enableCaptureTargetCreation(
				createCaptureChoice("folder:Goals|tag:active"),
			),
		);
		const variables = new Map<string, unknown>([
			[QA_INTERNAL_CAPTURE_TARGET_FILE_PATH, "Goals/New target.md"],
		]);

		expect(getUnresolvedRequirements(requirements, variables)).not.toContainEqual(
			expect.objectContaining({
				id: QA_INTERNAL_CAPTURE_TARGET_FILE_PATH,
			}),
		);
	});

	it("keeps an empty disabled dropdown when target creation is off", async () => {
		const requirements = await collectChoiceRequirements(
			app,
			plugin,
			choiceExecutor,
			createCaptureChoice("folder:Goals|tag:active"),
		);

		const target = requirements.find(
			(requirement) =>
				requirement.id === QA_INTERNAL_CAPTURE_TARGET_FILE_PATH,
		);
		expect(target).toMatchObject({
			type: "dropdown",
			options: [],
			displayOptions: [],
			placeholder: "No files found in target scope",
		});
		expect(target?.runtimeOnly).toBeUndefined();
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

describe("collectChoiceRequirements - image-paste path-context provenance (issue #1484)", () => {
	const templateBodies = new Map<string, string>();
	const app = {
		vault: {
			cachedRead: vi.fn(
				async (file: { path: string }) => templateBodies.get(file.path) ?? "",
			),
		},
		metadataCache: { getFileCache: vi.fn(() => null) },
	} as unknown as App;
	const plugin = {
		settings: {
			inputPrompt: "single-line",
			globalVariables: {},
			useSelectionAsCaptureValue: true,
		},
	} as any;

	beforeEach(() => {
		templateBodies.clear();
		getTemplateFileMock.mockReset();
		getTemplateFileMock.mockImplementation((_app: App, path: string) =>
			templateBodies.has(path) ? ({ path } as never) : null,
		);
	});

	function executor(): IChoiceExecutor {
		return { execute: vi.fn(), variables: new Map<string, unknown>() };
	}

	async function collect(choice: ICaptureChoice | ITemplateChoice) {
		return collectChoiceRequirements(app, plugin, executor(), choice);
	}

	function byId(
		requirements: Awaited<ReturnType<typeof collectChoiceRequirements>>,
		id: string,
	) {
		const requirement = requirements.find((req) => req.id === id);
		if (!requirement) throw new Error(`requirement '${id}' not collected`);
		return requirement;
	}

	it("marks variables used in the capture target as path context", async () => {
		const choice = {
			...createCaptureChoice("Journal/{{VALUE:topic}}.md"),
			format: { enabled: true, format: "{{VALUE:body}}" },
		} as ICaptureChoice;

		const requirements = await collect(choice);

		expect(byId(requirements, "topic").pathContext).toBe(true);
		expect(byId(requirements, "body").pathContext).toBeUndefined();
	});

	it("keeps a dual-use variable path-tainted regardless of scan order", async () => {
		// insertAfter is scanned AFTER the content format; the sticky mark must
		// still taint a variable first seen in content.
		const choice = {
			...createCaptureChoice("Inbox.md"),
			format: { enabled: true, format: "{{VALUE:section}}" },
			insertAfter: {
				enabled: true,
				after: "## {{VALUE:section}}",
				insertAtEnd: false,
				considerSubsections: false,
				createIfNotFound: false,
				createIfNotFoundLocation: "",
			},
		} as ICaptureChoice;

		const requirements = await collect(choice);

		expect(byId(requirements, "section").pathContext).toBe(true);
	});

	it("taints the anonymous VALUE when it also appears in a later path string", async () => {
		const choice = {
			...createCaptureChoice("Inbox.md"),
			format: { enabled: true, format: "note: {{VALUE}}" },
			insertBefore: {
				enabled: true,
				before: "{{VALUE}} marker",
				createIfNotFound: false,
				createIfNotFoundLocation: "",
			},
		} as ICaptureChoice;

		const requirements = await collect(choice);

		expect(byId(requirements, "value").pathContext).toBe(true);
	});

	it("marks template file-name and folder variables as path context, body as content", async () => {
		templateBodies.set("Templates/Note.md", "Body: {{VALUE:body}}");
		const choice = {
			id: "template-choice",
			name: "Template Choice",
			type: "Template",
			command: false,
			templatePath: "Templates/Note.md",
			fileNameFormat: { enabled: true, format: "{{VALUE:name}}" },
			folder: {
				enabled: true,
				folders: ["Projects/{{VALUE:area}}"],
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
		} as unknown as ITemplateChoice;

		const requirements = await collect(choice);

		expect(byId(requirements, "name").pathContext).toBe(true);
		expect(byId(requirements, "area").pathContext).toBe(true);
		expect(byId(requirements, "body").pathContext).toBeUndefined();
	});

	it("propagates path context into templates included from a path string", async () => {
		templateBodies.set("Templates/NamePart.md", "{{VALUE:part}}");
		const choice = {
			...createCaptureChoice("Inbox.md"),
			format: { enabled: true, format: "ok" },
			insertAfter: {
				enabled: true,
				after: "{{TEMPLATE:Templates/NamePart.md}}",
				insertAtEnd: false,
				considerSubsections: false,
				createIfNotFound: false,
				createIfNotFoundLocation: "",
			},
		} as ICaptureChoice;

		const requirements = await collect(choice);

		expect(byId(requirements, "part").pathContext).toBe(true);
	});

	it("keeps template-include variables in CONTENT strings unmarked", async () => {
		templateBodies.set("Templates/Snippet.md", "{{VALUE:snippetValue}}");
		const choice = {
			...createCaptureChoice("Inbox.md"),
			format: {
				enabled: true,
				format: "{{TEMPLATE:Templates/Snippet.md}}",
			},
		} as ICaptureChoice;

		const requirements = await collect(choice);

		expect(byId(requirements, "snippetValue").pathContext).toBeUndefined();
	});
});

describe("collectChoiceRequirements - path-context memo (issue #1484 review fix)", () => {
	const templateBodies = new Map<string, string>();
	const app = {
		vault: {
			cachedRead: vi.fn(
				async (file: { path: string }) => templateBodies.get(file.path) ?? "",
			),
		},
		metadataCache: { getFileCache: vi.fn(() => null) },
	} as unknown as App;
	const plugin = {
		settings: {
			inputPrompt: "single-line",
			globalVariables: {},
			useSelectionAsCaptureValue: true,
		},
	} as any;

	beforeEach(() => {
		templateBodies.clear();
		getTemplateFileMock.mockReset();
		getTemplateFileMock.mockImplementation((_app: App, path: string) =>
			templateBodies.has(path) ? ({ path } as never) : null,
		);
	});

	it("re-taints a template first scanned from content when a path string includes it too", async () => {
		// The template-inclusion memo must be keyed per context: the capture
		// FORMAT (content) is scanned before insert-after (path), so a
		// ref-only memo would skip the second walk and leave `part` pastable.
		templateBodies.set("Templates/Shared.md", "{{VALUE:part}}");
		const choice = {
			...createCaptureChoice("Inbox.md"),
			format: {
				enabled: true,
				format: "{{TEMPLATE:Templates/Shared.md}}",
			},
			insertAfter: {
				enabled: true,
				after: "{{TEMPLATE:Templates/Shared.md}}",
				insertAtEnd: false,
				considerSubsections: false,
				createIfNotFound: false,
				createIfNotFoundLocation: "",
			},
		} as ICaptureChoice;

		const requirements = await collectChoiceRequirements(
			app,
			plugin,
			{ execute: vi.fn(), variables: new Map<string, unknown>() },
			choice,
		);

		const part = requirements.find((req) => req.id === "part");
		expect(part?.pathContext).toBe(true);
	});

	it("taints {{MVALUE}} used in a capture target", async () => {
		const choice = {
			...createCaptureChoice("Math/{{MVALUE}}.md"),
			format: { enabled: true, format: "{{MVALUE}}" },
		} as ICaptureChoice;

		const requirements = await collectChoiceRequirements(
			app,
			plugin,
			{ execute: vi.fn(), variables: new Map<string, unknown>() },
			choice,
		);

		const mvalue = requirements.find((req) => req.id === "mvalue");
		expect(mvalue?.pathContext).toBe(true);
	});

	it("keeps {{MVALUE}} used only in content pastable", async () => {
		const choice = {
			...createCaptureChoice("Inbox.md"),
			format: { enabled: true, format: "{{MVALUE}}" },
		} as ICaptureChoice;

		const requirements = await collectChoiceRequirements(
			app,
			plugin,
			{ execute: vi.fn(), variables: new Map<string, unknown>() },
			choice,
		);

		const mvalue = requirements.find((req) => req.id === "mvalue");
		expect(mvalue?.pathContext).toBeUndefined();
	});
});
