import { createPreflightPlugin } from "../../tests/helpers/preflight/choices";
import type { FieldRequirement } from "./fieldRequirements";
import { createCaptureChoice, createTemplateChoice } from "../../tests/helpers/preflight/choices";
import { createChoiceExecutor } from "../../tests/helpers/createChoiceExecutor";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { TFile, TFolder, type App } from "obsidian";
import type { IChoiceExecutor } from "src/IChoiceExecutor";
import type ICaptureChoice from "src/types/choices/ICaptureChoice";
import type IMacroChoice from "src/types/choices/IMacroChoice";
import type ITemplateChoice from "src/types/choices/ITemplateChoice";
import { TemplateChoice } from "src/types/choices/TemplateChoice";
import { CommandType } from "src/types/macros/CommandType";
import type { IChoiceCommand } from "src/types/macros/IChoiceCommand";
import type { ICommand } from "src/types/macros/ICommand";
import type { IUserScript } from "src/types/macros/IUserScript";
import type { IConditionalCommand } from "src/types/macros/Conditional/IConditionalCommand";
import type { INestedChoiceCommand } from "src/types/macros/QuickCommands/INestedChoiceCommand";
import type IChoice from "src/types/choices/IChoice";
import {
	QA_INTERNAL_CAPTURE_TARGET_FILE_PATH,
	QA_INTERNAL_DATE_ORIGIN,
} from "src/constants";
import {
	collectChoiceRequirements,
	getUnresolvedRequirements,
	listDeferredMacroSteps,
} from "./collectChoiceRequirements";
import { captureTargetKeyFor, readPreselectedCaptureTarget } from "./captureTargetKey";

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

function expectCollectedFields(requirements: FieldRequirement[], ...fields: Partial<FieldRequirement>[]): void {
	expect(requirements).toEqual(expect.arrayContaining(fields.map((field) => expect.objectContaining(field))));
}

function createMacroChoice(...commands: ICommand[]): IMacroChoice {
	return {
		id: "macro-choice",
		name: "Macro Choice",
		type: "Macro",
		command: false,
		runOnStartup: false,
		macro: {
			id: "macro-choice",
			name: "Macro Choice",
			commands,
		},
	};
}

function nestedChoice(choice: IChoice): INestedChoiceCommand {
	return {
		id: `nested-${choice.id}`,
		name: choice.name,
		type: CommandType.NestedChoice,
		choice,
	};
}

function choiceCommand(id: string, name: string, choiceId: string): IChoiceCommand {
	return {
		id,
		name,
		type: CommandType.Choice,
		choiceId,
	};
}

function conditionalCommand(
	id: string,
	name: string,
	thenCommands: ICommand[],
): IConditionalCommand {
	return {
		id,
		name,
		type: CommandType.Conditional,
		condition: {
			mode: "variable",
			variableName: "x",
			operator: "isTruthy",
			valueType: "boolean",
		},
		thenCommands,
		elseCommands: [],
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
	const collect = (choice: IChoice, executor: IChoiceExecutor, options?: Parameters<typeof collectChoiceRequirements>[4]) =>
		collectChoiceRequirements(app, plugin, executor, choice, options);

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
	const plugin = createPreflightPlugin();

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
		const choiceExecutor = createChoiceExecutor();
		const captureChoice = {
			...createCaptureChoice("Inbox.md"),
			format: {
				enabled: true,
				format: "{{TEMPLATE:Templates/Capture Format.md}}",
			},
		} as ICaptureChoice;

		const requirements = await collect(captureChoice, choiceExecutor);

		expectCollectedFields(requirements, { id: "includedValue" });
		expect(cachedReadMock).toHaveBeenCalledWith(
			expect.objectContaining({ path: "Templates/Capture Format.md" }),
		);
	});

	it("does not recurse into TEMPLATE includes introduced by global variables", async () => {
		templateBodies.set(
			"Templates/From Global.md",
			"{{VALUE:fromGlobalTemplate}}",
		);
		const choiceExecutor = createChoiceExecutor();
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
		const choiceExecutor = createChoiceExecutor();
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

		expectCollectedFields(requirements, { id: "fromGlobalValue" });
	});

	it("collects requirements from TEMPLATE includes in Capture targets", async () => {
		templateBodies.set(
			"Templates/Capture Target.md",
			"Inbox/{{VALUE:captureTargetName}}.md",
		);
		const choiceExecutor = createChoiceExecutor();

		const requirements = await collect(createCaptureChoice("{{TEMPLATE:Templates/Capture Target.md}}"), choiceExecutor);

		expectCollectedFields(requirements, { id: "captureTargetName" });
	});

	it("collects requirements from TEMPLATE includes in Capture insert-after targets", async () => {
		templateBodies.set(
			"Templates/Heading.md",
			"## {{VALUE:insertAfterHeading}}",
		);
		const choiceExecutor = createChoiceExecutor();
		const captureChoice = {
			...createCaptureChoice("Inbox.md"),
			insertAfter: {
				...createCaptureChoice("Inbox.md").insertAfter,
				enabled: true,
				after: "{{TEMPLATE:Templates/Heading.md}}",
			},
		} as ICaptureChoice;

		const requirements = await collect(captureChoice, choiceExecutor);

		expectCollectedFields(requirements, { id: "insertAfterHeading" });
	});

	it("collects requirements from TEMPLATE includes in Capture insert-before targets", async () => {
		templateBodies.set(
			"Templates/Before.md",
			"## {{VALUE:insertBeforeHeading}}",
		);
		const choiceExecutor = createChoiceExecutor();
		const captureChoice = {
			...createCaptureChoice("Inbox.md"),
			insertBefore: {
				enabled: true,
				before: "{{TEMPLATE:Templates/Before.md}}",
				createIfNotFound: false,
				createIfNotFoundLocation: "top",
			},
		} as ICaptureChoice;

		const requirements = await collect(captureChoice, choiceExecutor);

		expectCollectedFields(requirements, { id: "insertBeforeHeading" });
	});

	it("collects requirements from TEMPLATE includes in Template file names", async () => {
		templateBodies.set("Templates/Source.md", "Body");
		templateBodies.set(
			"Templates/File Name.md",
			"{{VALUE:templateFileName}}",
		);
		const choiceExecutor = createChoiceExecutor();
		const templateChoice = {
			...createTemplateChoice("Templates/Source.md"),
			fileNameFormat: {
				enabled: true,
				format: "{{TEMPLATE:Templates/File Name.md}}",
			},
		} as ITemplateChoice;

		const requirements = await collect(templateChoice, choiceExecutor);

		expectCollectedFields(requirements, { id: "templateFileName" });
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
		const choiceExecutor = createChoiceExecutor();
		const captureChoice = {
			...createCaptureChoice("Inbox.md"),
			format: {
				enabled: true,
				format: "{{TEMPLATE:Templates/Capture Outer.md}}",
			},
		} as ICaptureChoice;

		const requirements = await collect(captureChoice, choiceExecutor);

		expectCollectedFields(requirements, { id: "nestedIncludedValue" });
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
		const choiceExecutor = createChoiceExecutor();
		const captureChoice = {
			...createCaptureChoice("Inbox.md"),
			format: {
				enabled: true,
				format: "{{TEMPLATE:Templates/T0.md}}",
			},
		} as ICaptureChoice;

		const requirements = await collect(captureChoice, choiceExecutor);

		expectCollectedFields(requirements, { id: "atRuntimeLimit" });
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
		const choiceExecutor = createChoiceExecutor();
		const captureChoice = {
			...createCaptureChoice("Inbox.md"),
			format: {
				enabled: true,
				format: "{{TEMPLATE:Templates/Root Deep.md}}",
			},
		} as ICaptureChoice;

		const requirements = await collect(captureChoice, choiceExecutor);

		expectCollectedFields(requirements, { id: "sharedNestedValue" });
		expect(cachedReadMock).toHaveBeenCalledWith(
			expect.objectContaining({ path: "Templates/Nested.md" }),
		);
	});

	it("collects requirements from Capture create-with-template literal bodies", async () => {
		templateBodies.set(
			"Templates/Create Body.md",
			"Created with {{VALUE:createBodyValue}}",
		);
		const choiceExecutor = createChoiceExecutor();
		const captureChoice = {
			...createCaptureChoice("Inbox.md"),
			createFileIfItDoesntExist: {
				enabled: true,
				createWithTemplate: true,
				template: "Templates/Create Body.md",
			},
		} as ICaptureChoice;

		const requirements = await collect(captureChoice, choiceExecutor);

		expectCollectedFields(requirements, { id: "createBodyValue" });
	});

	it("keeps recursive TEMPLATE scanning for Template choices", async () => {
		templateBodies.set(
			"Templates/Outer.md",
			"Outer {{TEMPLATE:Templates/Inner.md}}",
		);
		templateBodies.set("Templates/Inner.md", "Inner {{VALUE:templateValue}}");
		const choiceExecutor = createChoiceExecutor();

		const requirements = await collect(createTemplateChoice("Templates/Outer.md"), choiceExecutor);

		expectCollectedFields(requirements, { id: "templateValue" });
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
		const choiceExecutor = createChoiceExecutor();

		const requirements = await collect(createTemplateChoice("Templates/Root.md"), choiceExecutor);

		// Completeness: the deepest layer's requirement is still collected.
		expectCollectedFields(requirements, { id: "leafValue" });
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
		const choiceExecutor = createChoiceExecutor();

		const requirements = await collect(createTemplateChoice("Templates/Root.md"), choiceExecutor);

		expectCollectedFields(requirements, { id: "deepEleven" });
	});
});

describe("collectChoiceRequirements - macro script metadata", () => {
	const collect = (choice: IChoice, executor: IChoiceExecutor, options?: Parameters<typeof collectChoiceRequirements>[4]) =>
		collectChoiceRequirements(app, plugin, executor, choice, options);

	const app = {} as App;
	const plugin = {} as any;
	const choiceExecutor = createChoiceExecutor();

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

		const requirements = await collect(createMacroChoice(scriptCommand), choiceExecutor);

		expectCollectedFields(requirements, {
			id: "project",
			type: "text",
			label: "Project",
			source: "script",
		});
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

		await collect(createMacroChoice(scriptCommand), choiceExecutor, { preloadedUserScripts });

		expect(getUserScriptMock).toHaveBeenCalledTimes(1);
		expect(preloadedUserScripts.get("script.js")).toBe(exported);

		// A second collection pass (e.g. CLI collect followed by the one-page
		// preflight) must reuse the cached module, not execute it again.
		const requirements = await collect(createMacroChoice(scriptCommand), choiceExecutor, { preloadedUserScripts });

		expect(getUserScriptMock).toHaveBeenCalledTimes(1);
		expectCollectedFields(requirements, { id: "project" });
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

		const requirements = await collect(macroChoice, choiceExecutor, { preloadedUserScripts });

		expect(getUserScriptMock).toHaveBeenCalledTimes(2);
		expect(preloadedUserScripts.get("script.js::foo")).toBe(fooExport);
		expect(preloadedUserScripts.get("script.js::bar")).toBe(barExport);
		expectCollectedFields(requirements, { id: "fooInput" }, { id: "barInput" });
	});

	it("reads quickadd.inputs from object exports", async () => {
		getUserScriptMock.mockResolvedValue({
			quickadd: {
				inputs: [{ id: "project", type: "text", label: "Project" }],
			},
		});

		const requirements = await collect(createMacroChoice(scriptCommand), choiceExecutor);

		expectCollectedFields(requirements, {
			id: "project",
			type: "text",
			label: "Project",
			source: "script",
		});
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

		const requirements = await collect(createMacroChoice(scriptCommand), choiceExecutor);

		expectCollectedFields(requirements, {
			id: "rating",
			type: "number",
			numericConfig: { min: 1, max: 10, step: 1 },
			source: "script",
		}, {
			id: "confidence",
			type: "slider",
			defaultValue: "5",
			numericConfig: { min: 0, max: 100, step: 5 },
			sliderConfig: { min: 0, max: 100, step: 5 },
			source: "script",
		});
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

		const requirements = await collect(createMacroChoice(scriptCommand), choiceExecutor);

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

		const requirements = await collect(createMacroChoice(scriptCommand), choiceExecutor);

		expect(requirements).toEqual([]);
	});

	it("logs a warning when script metadata cannot be inspected", async () => {
		getUserScriptMock.mockRejectedValue(new Error("script load failed"));

		const requirements = await collect(createMacroChoice(scriptCommand), choiceExecutor);

		expect(requirements).toEqual([]);
		expect(logWarningMock).toHaveBeenCalledWith(
			expect.stringContaining(
				"Preflight could not inspect user script 'script.js'",
			),
		);
	});
});

describe("collectChoiceRequirements - capture targets", () => {
	const collect = (choice: IChoice, executor: IChoiceExecutor, options?: Parameters<typeof collectChoiceRequirements>[4]) =>
		collectChoiceRequirements(app, plugin, executor, choice, options);

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
	const plugin = createPreflightPlugin();
	const choiceExecutor = createChoiceExecutor();

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

	it.each([
		{
			name: "treats a definite .md target as a file even when a same-named folder exists",
			target: "Projects.md", folderExists: true, collision: null, needsPicker: false,
		},
		{
			name: "treats a bare name as a file when both the folder and a same-named note exist",
			target: "Projects", folderExists: true, collision: "file", needsPicker: false,
		},
		{
			name: "still forces the dropdown when a same-named FOLDER (not a note) shares the X.md name",
			target: "Projects", folderExists: true, collision: "folder", needsPicker: true,
		},
		{
			name: "forces the capture target dropdown for a bare folder name with no same-named note",
			target: "Projects", folderExists: true, collision: null, needsPicker: true,
		},
		{
			name: "does not force capture target dropdown for tokenized file paths",
			target: "Projects/{{VALUE}}.md", folderExists: false, collision: null, needsPicker: false,
		},
	])("$name", async ({ target, folderExists, collision, needsPicker }) => {
		isFolderMock.mockReturnValue(folderExists);
		getAbstractFileByPathMock.mockImplementation((path: string) => {
			if (path !== "Projects.md" || !collision) return null;
			return Object.assign(collision === "file" ? new TFile() : new TFolder(), { path });
		});
		const requirements = await collect(createCaptureChoice(target), choiceExecutor);
		if (needsPicker) {
			expect(getMarkdownFilesInFolderMock).toHaveBeenCalledWith(app, "Projects/");
		} else {
			expect(getMarkdownFilesInFolderMock).not.toHaveBeenCalled();
		}
		expect(requirements.some((requirement) => requirement.id === captureTargetKeyFor("capture-choice")))
			.toBe(needsPicker);
	});

	it("forces the capture target dropdown for a property:field=value target (issue #466)", async () => {
		const requirements = await collect(createCaptureChoice("property:type=draft"), choiceExecutor);

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
					requirement.id === captureTargetKeyFor("capture-choice"),
			),
		).toBe(true);
	});

	it("treats a value-less property target as presence mode (undefined value)", async () => {
		await collect(createCaptureChoice("property:type"), choiceExecutor);

		expect(getMarkdownFilesWithPropertyMock).toHaveBeenCalledWith(
			app,
			"type",
			undefined,
			expect.any(Object),
		);
	});

	it("passes pipe filters through to the property query", async () => {
		await collect(createCaptureChoice("property:type=draft|folder:Notes"), choiceExecutor);

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

		const requirements = await collect(createCaptureChoice("folder:Goals|folder:Projects|tag:active"), choiceExecutor);

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
				requirement.id === captureTargetKeyFor("capture-choice"),
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
		const requirements = await collect(
			enableCaptureTargetCreation(
				createCaptureChoice("folder:Goals|tag:active"),
			),
			choiceExecutor,
		);

		const target = requirements.find(
			(requirement) =>
				requirement.id === captureTargetKeyFor("capture-choice"),
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
		const requirements = await collect(
			enableCaptureTargetCreation(
				createCaptureChoice("folder:Goals|tag:active"),
			),
			choiceExecutor,
		);
		const scopedId = captureTargetKeyFor("capture-choice");
		expect(requirements).toContainEqual(
			expect.objectContaining({ id: scopedId }),
		);
		const variables = new Map<string, unknown>([
			[QA_INTERNAL_CAPTURE_TARGET_FILE_PATH, "Goals/New target.md"],
		]);

		expect(getUnresolvedRequirements(requirements, variables)).not.toContainEqual(
			expect.objectContaining({
				id: scopedId,
			}),
		);
	});

	it("keeps an empty disabled dropdown when target creation is off", async () => {
		const requirements = await collect(createCaptureChoice("folder:Goals|tag:active"), choiceExecutor);

		const target = requirements.find(
			(requirement) =>
				requirement.id === captureTargetKeyFor("capture-choice"),
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
		const requirements = await collect(createCaptureChoice("#work|multi"), choiceExecutor);

		expect(getMarkdownFilesMatchingFilterMock).not.toHaveBeenCalled();
		expect(getMarkdownFilesWithTagMock).not.toHaveBeenCalled();
		expect(getMarkdownFilesInFolderMock).not.toHaveBeenCalled();
		expect(
			requirements.some(
				(requirement) =>
					requirement.id === captureTargetKeyFor("capture-choice"),
			),
		).toBe(false);
	});

	it("does not force the dropdown for a tokenized property value", async () => {
		const requirements = await collect(createCaptureChoice("property:type={{VALUE}}"), choiceExecutor);

		expect(getMarkdownFilesWithPropertyMock).not.toHaveBeenCalled();
		expect(
			requirements.some(
				(requirement) =>
					requirement.id === captureTargetKeyFor("capture-choice"),
			),
		).toBe(false);
	});

	it("does not force the dropdown for a property target missing a field name", async () => {
		const requirements = await collect(createCaptureChoice("property:"), choiceExecutor);

		expect(getMarkdownFilesWithPropertyMock).not.toHaveBeenCalled();
		expect(
			requirements.some(
				(requirement) =>
					requirement.id === captureTargetKeyFor("capture-choice"),
			),
		).toBe(false);
	});
});

describe("collectChoiceRequirements - template path format syntax (issue #620)", () => {
	const collect = (choice: IChoice, executor: IChoiceExecutor, options?: Parameters<typeof collectChoiceRequirements>[4]) =>
		collectChoiceRequirements(app, plugin, executor, choice, options);

	const app = {} as App;
	const plugin = { settings: { inputPrompt: "single-line" } } as any;

	beforeEach(() => {
		getTemplateFileMock.mockReset();
		getTemplateFileMock.mockReturnValue(null);
		logMessageMock.mockReset();
	});

	it("collects a token in the template PATH itself and skips reading the (non-existent) body", async () => {
		const choiceExecutor = createChoiceExecutor();

		const requirements = await collect(createTemplateChoice("Templates/{{VALUE:collectionName}} Template.md"), choiceExecutor);

		expectCollectedFields(requirements, { id: "collectionName" });
		// A dynamic path can't be resolved at preflight, so the body walk is
		// skipped — getTemplateFile must not be called for a tokenized path.
		expect(getTemplateFileMock).not.toHaveBeenCalled();
	});

	it("still walks the body for a literal (token-free) path", async () => {
		const choiceExecutor = createChoiceExecutor();

		await collect(createTemplateChoice("Templates/Note.md"), choiceExecutor);

		expect(getTemplateFileMock).toHaveBeenCalled();
	});

	it("collects a token in a Capture create-with-template path", async () => {
		const choiceExecutor = createChoiceExecutor();

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

		expectCollectedFields(requirements, { id: "kind" });
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
	const plugin = createPreflightPlugin();

	beforeEach(() => {
		templateBodies.clear();
		getTemplateFileMock.mockReset();
		getTemplateFileMock.mockImplementation((_app: App, path: string) =>
			templateBodies.has(path) ? ({ path } as never) : null,
		);
	});

	function executor(): IChoiceExecutor {
		return createChoiceExecutor();
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
	const collect = (choice: IChoice, executor: IChoiceExecutor, options?: Parameters<typeof collectChoiceRequirements>[4]) =>
		collectChoiceRequirements(app, plugin, executor, choice, options);

	const templateBodies = new Map<string, string>();
	const app = {
		vault: {
			cachedRead: vi.fn(
				async (file: { path: string }) => templateBodies.get(file.path) ?? "",
			),
		},
		metadataCache: { getFileCache: vi.fn(() => null) },
	} as unknown as App;
	const plugin = createPreflightPlugin();

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

		const requirements = await collect(
			choice,
			{ ...createChoiceExecutor(), execute: vi.fn(), variables: new Map<string, unknown>() },
		);

		const part = requirements.find((req) => req.id === "part");
		expect(part?.pathContext).toBe(true);
	});

	it("taints {{MVALUE}} used in a capture target", async () => {
		const choice = {
			...createCaptureChoice("Math/{{MVALUE}}.md"),
			format: { enabled: true, format: "{{MVALUE}}" },
		} as ICaptureChoice;

		const requirements = await collect(
			choice,
			{ ...createChoiceExecutor(), execute: vi.fn(), variables: new Map<string, unknown>() },
		);

		const mvalue = requirements.find((req) => req.id === "mvalue");
		expect(mvalue?.pathContext).toBe(true);
	});

	it("keeps {{MVALUE}} used only in content pastable", async () => {
		const choice = {
			...createCaptureChoice("Inbox.md"),
			format: { enabled: true, format: "{{MVALUE}}" },
		} as ICaptureChoice;

		const requirements = await collect(
			choice,
			{ ...createChoiceExecutor(), execute: vi.fn(), variables: new Map<string, unknown>() },
		);

		const mvalue = requirements.find((req) => req.id === "mvalue");
		expect(mvalue?.pathContext).toBeUndefined();
	});
});

describe("collectChoiceRequirements - pickDate", () => {
	const collect = (choice: IChoice, executor: IChoiceExecutor, options?: Parameters<typeof collectChoiceRequirements>[4]) =>
		collectChoiceRequirements(app, plugin, executor, choice, options);

	const app = {
		vault: { cachedRead: vi.fn(async () => "") },
		metadataCache: { getFileCache: vi.fn(() => null) },
	} as unknown as App;
	const plugin = createPreflightPlugin();

	it("collects a date field when pickDate is set on a Today choice", async () => {
		const choice = createCaptureChoice("Inbox.md");
		const requirements = await collect(
			choice,
			{
				...createChoiceExecutor(),
				execute: vi.fn(),
				variables: new Map<string, unknown>(),
				pickDate: true,
			},
		);
		expect(
			requirements.some((requirement) => requirement.id === QA_INTERNAL_DATE_ORIGIN),
		).toBe(true);
	});

	it("does not collect a date field for a Today choice without pickDate", async () => {
		const choice = createCaptureChoice("Inbox.md");
		const requirements = await collect(choice, createChoiceExecutor());
		expect(
			requirements.some((requirement) => requirement.id === QA_INTERNAL_DATE_ORIGIN),
		).toBe(false);
	});

	it("collects a date field for an Ask macro", async () => {
		const choice = {
			...createMacroChoice(),
			dateOrigin: { kind: "ask" as const },
		};
		const requirements = await collect(choice, createChoiceExecutor());
		expect(
			requirements.some((requirement) => requirement.id === QA_INTERNAL_DATE_ORIGIN),
		).toBe(true);
	});
});

describe("collectChoiceRequirements - macro form roster", () => {
	const getSelection = vi.fn(() => "");
	const app = {
		vault: { getAbstractFileByPath: vi.fn(() => null) },
		metadataCache: { getFileCache: vi.fn(() => null) },
		workspace: {
			getActiveViewOfType: () => ({ editor: { getSelection } }),
		},
	} as unknown as App;
	const choiceExecutor = createChoiceExecutor();

	function pluginWithChoices(
		choices: Record<string, IChoice> = {},
	): { settings: Record<string, unknown>; getChoiceById: (id: string) => IChoice } {
		return {
			settings: {
				inputPrompt: "single-line",
				globalVariables: {},
				useSelectionAsCaptureValue: true,
			},
			getChoiceById: (id: string) => {
				const found = choices[id];
				if (!found) throw new Error(`Choice ${id} not found`);
				return found;
			},
		};
	}

	beforeEach(() => {
		getMarkdownFilesInFolderMock.mockReset();
		getMarkdownFilesWithTagMock.mockReset();
		getUserScriptMock.mockReset();
		isFolderMock.mockReset();
		logWarningMock.mockReset();
		getMarkdownFilesInFolderMock.mockReturnValue([]);
		getMarkdownFilesWithTagMock.mockReturnValue([]);
		isFolderMock.mockReturnValue(true);
		getUserScriptMock.mockResolvedValue({});
		choiceExecutor.variables.clear();
		getSelection.mockReset();
		getSelection.mockReturnValue("");
	});

	it("emits two scoped capture-target ids for two NestedChoice folder captures", async () => {
		const first = { ...createCaptureChoice("Projects"), id: "cap-a", name: "Projects dump" };
		const second = { ...createCaptureChoice("Inbox"), id: "cap-b", name: "Inbox dump" };

		const requirements = await collectChoiceRequirements(
			app,
			pluginWithChoices() as any,
			choiceExecutor,
			createMacroChoice(nestedChoice(first), nestedChoice(second)),
		);

		const ids = requirements
			.filter((requirement) => requirement.id.startsWith("__qa.captureTargetFilePath."))
			.map((requirement) => requirement.id);
		expect(ids).toEqual([
			captureTargetKeyFor("cap-a"),
			captureTargetKeyFor("cap-b"),
		]);
		expect(ids).not.toContain(QA_INTERNAL_CAPTURE_TARGET_FILE_PATH);

		const variables = new Map<string, unknown>([
			[QA_INTERNAL_CAPTURE_TARGET_FILE_PATH, "Projects/Shared.md"],
		]);
		expect(
			getUnresolvedRequirements(requirements, variables).map(
				(requirement) => requirement.id,
			),
		).toEqual([
			captureTargetKeyFor("cap-a"),
			captureTargetKeyFor("cap-b"),
		]);
	});

	it("stamps scoped keys so direct execution cannot reuse the unscoped alias", async () => {
		const first = { ...createCaptureChoice("Projects"), id: "cap-a", name: "Projects dump" };
		const second = { ...createCaptureChoice("Inbox"), id: "cap-b", name: "Inbox dump" };
		choiceExecutor.variables.set(
			QA_INTERNAL_CAPTURE_TARGET_FILE_PATH,
			"Projects/Shared.md",
		);

		await collectChoiceRequirements(
			app,
			pluginWithChoices() as any,
			choiceExecutor,
			createMacroChoice(nestedChoice(first), nestedChoice(second)),
		);

		expect(choiceExecutor.variables.get(captureTargetKeyFor("cap-a"))).toBeNull();
		expect(choiceExecutor.variables.get(captureTargetKeyFor("cap-b"))).toBeNull();
		expect(
			readPreselectedCaptureTarget(choiceExecutor.variables, "cap-a"),
		).toBeUndefined();
		expect(
			readPreselectedCaptureTarget(choiceExecutor.variables, "cap-b"),
		).toBeUndefined();
	});

	it("merges a shared {{VALUE:project}} into one field", async () => {
		isFolderMock.mockReturnValue(false);
		const first = {
			...createCaptureChoice("Inbox.md"),
			id: "cap-a",
			name: "First",
			format: { enabled: true, format: "A {{VALUE:project}}" },
		};
		const second = {
			...createCaptureChoice("Inbox.md"),
			id: "cap-b",
			name: "Second",
			format: { enabled: true, format: "B {{VALUE:project}}" },
		};

		const requirements = await collectChoiceRequirements(
			app,
			pluginWithChoices() as any,
			choiceExecutor,
			createMacroChoice(nestedChoice(first), nestedChoice(second)),
		);

		expect(requirements.filter((requirement) => requirement.id === "project")).toHaveLength(1);
		expect(requirements.find((requirement) => requirement.id === "project")?.group).toEqual({
			id: "cap-a",
			label: "First",
		});
	});

	it("ANDs optionality when the same VALUE is optional in one member and required in another", async () => {
		isFolderMock.mockReturnValue(false);
		const optionalFirst = {
			...createCaptureChoice("Inbox.md"),
			id: "cap-a",
			name: "First",
			format: { enabled: true, format: "{{VALUE:project|optional}}" },
		};
		const requiredSecond = {
			...createCaptureChoice("Inbox.md"),
			id: "cap-b",
			name: "Second",
			format: { enabled: true, format: "{{VALUE:project}}" },
		};

		const optionalThenRequired = await collectChoiceRequirements(
			app,
			pluginWithChoices() as any,
			choiceExecutor,
			createMacroChoice(nestedChoice(optionalFirst), nestedChoice(requiredSecond)),
		);
		expect(
			optionalThenRequired.find((requirement) => requirement.id === "project")
				?.optional,
		).toBe(false);

		choiceExecutor.variables.clear();
		const requiredThenOptional = await collectChoiceRequirements(
			app,
			pluginWithChoices() as any,
			choiceExecutor,
			createMacroChoice(nestedChoice(requiredSecond), nestedChoice(optionalFirst)),
		);
		expect(
			requiredThenOptional.find((requirement) => requirement.id === "project")
				?.optional,
		).toBe(false);
	});

	describe("discovery before anonymous macro inputs", () => {
		it("reports only truly deferred steps when the discovery title is seeded", () => {
			const template = discoveryTemplate();
			const capture = captureChoice();
			const macro = createMacroChoice(nestedChoice(template), nestedChoice(capture));
			const plugin = pluginWithChoices();
			expect(listDeferredMacroSteps(plugin, macro, undefined).map((step) => step.label))
				.toEqual([template.name, capture.name]);
			for (const value of ["Seeded title", ""]) {
				expect(listDeferredMacroSteps(plugin, macro, value).map((step) => step.label))
					.toEqual([template.name]);
			}
		});
		function discoveryTemplate(): TemplateChoice {
			const template = new TemplateChoice("Discover note");
			template.templatePath = "Templates/Note.md";
			template.discoverExistingNotesBeforeCreate = true;
			template.onePageInput = "never";
			template.fileNameFormat = { enabled: true, format: "{{VALUE}}" };
			return template;
		}

		function captureChoice(): ICaptureChoice {
			return {
				...createCaptureChoice("Inbox.md"),
				format: { enabled: true, format: "{{VALUE}} {{VALUE:details}}" },
			};
		}

		it.each(["nested", "referenced"])(
			"defers the remaining form after an opted-out %s discovery Template",
			async (commandKind) => {
				isFolderMock.mockReturnValue(false);
				const template = discoveryTemplate();
				const templateCommand = commandKind === "nested"
					? nestedChoice(template)
					: choiceCommand("template-command", template.name, template.id);
				const requirements = await collectChoiceRequirements(
					app,
					pluginWithChoices({ [template.id]: template }) as any,
					choiceExecutor,
					createMacroChoice(templateCommand, nestedChoice(captureChoice())),
				);

				expect(requirements).toEqual([]);
			},
		);

		it.each([
			{ label: "disabled filename format", enabled: false, format: "Custom {{VALUE}}", discover: true, deferred: true },
			{ label: "NAME filename format", enabled: true, format: "{{NAME}}", discover: true, deferred: true },
			{ label: "custom filename format", enabled: true, format: "Custom {{VALUE}}", discover: true, deferred: false },
			{ label: "discovery disabled", enabled: true, format: "{{VALUE}}", discover: false, deferred: false },
		])("handles $label without changing unrelated macro input collection", async ({ enabled, format, discover, deferred }) => {
			isFolderMock.mockReturnValue(false);
			const template = discoveryTemplate();
			template.fileNameFormat = { enabled, format };
			template.discoverExistingNotesBeforeCreate = discover;
			const requirements = await collectChoiceRequirements(
				app,
				pluginWithChoices() as any,
				choiceExecutor,
				createMacroChoice(nestedChoice(template), nestedChoice(captureChoice())),
			);

			expect(requirements.filter((requirement) => !requirement.runtimeOnly)
				.map((requirement) => requirement.id).sort()).toEqual(deferred ? [] : ["details", "value"]);
		});

		it("leaves selected text for the Capture's own preflight after discovery", async () => {
			isFolderMock.mockReturnValue(false);
			getSelection.mockReturnValue("Selected capture text");
			const capture = captureChoice();
			await collectChoiceRequirements(
				app,
				pluginWithChoices() as any,
				choiceExecutor,
				createMacroChoice(nestedChoice(discoveryTemplate()), nestedChoice(capture)),
				{ seedCaptureSelectionAsValue: true },
			);
			expect(choiceExecutor.variables.has("value")).toBe(false);

			await collectChoiceRequirements(
				app,
				pluginWithChoices() as any,
				choiceExecutor,
				capture,
				{ seedCaptureSelectionAsValue: true },
			);
			expect(choiceExecutor.variables.get("value")).toBe("Selected capture text");
		});

		it("preserves an explicitly seeded value", async () => {
			isFolderMock.mockReturnValue(false);
			choiceExecutor.variables.set("value", "Explicit note title");
			getSelection.mockReturnValue("Selected capture text");
			const requirements = await collectChoiceRequirements(
				app,
				pluginWithChoices() as any,
				choiceExecutor,
				createMacroChoice(nestedChoice(discoveryTemplate()), nestedChoice(captureChoice())),
				{ seedCaptureSelectionAsValue: true },
			);

			expect(choiceExecutor.variables.get("value")).toBe("Explicit note title");
			expect(getUnresolvedRequirements(requirements, choiceExecutor.variables)
				.map((requirement) => requirement.id)).toEqual(["details"]);
		});

		it("does not load a later script before the discovery picker", async () => {
			getUserScriptMock.mockResolvedValue({
				quickadd: {
					inputs: [
						{ id: "value", type: "text", label: "Value" },
						{ id: "details", type: "text", label: "Details" },
					],
				},
			});
			const script: IUserScript = {
				id: "script-1",
				name: "Script 1",
				type: CommandType.UserScript,
				path: "script.js",
				settings: {},
			};
			const requirements = await collectChoiceRequirements(
				app,
				pluginWithChoices() as any,
				choiceExecutor,
				createMacroChoice(nestedChoice(discoveryTemplate()), script),
			);

			expect(requirements).toEqual([]);
			expect(getUserScriptMock).not.toHaveBeenCalled();
		});
	});

	it("ORs runtimeOnly when a discovery Template shares VALUE with a Capture", async () => {
		isFolderMock.mockReturnValue(false);
		const capture = {
			...createCaptureChoice("Inbox.md"),
			id: "cap-a",
			name: "Capture",
			format: { enabled: true, format: "{{VALUE}}" },
		};
		const template = {
			id: "tmpl-a",
			name: "Discover note",
			type: "Template",
			command: false,
			templatePath: "Templates/Note.md",
			fileNameFormat: { enabled: true, format: "{{VALUE}}" },
			discoverExistingNotesBeforeCreate: true,
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

		const captureThenTemplate = await collectChoiceRequirements(
			app,
			pluginWithChoices() as any,
			choiceExecutor,
			createMacroChoice(nestedChoice(capture), nestedChoice(template)),
		);
		expect(
			captureThenTemplate.find((requirement) => requirement.id === "value")
				?.runtimeOnly,
		).toBe(true);

		choiceExecutor.variables.clear();
		const templateThenCapture = await collectChoiceRequirements(
			app,
			pluginWithChoices() as any,
			choiceExecutor,
			createMacroChoice(nestedChoice(template), nestedChoice(capture)),
		);
		expect(
			templateThenCapture.find((requirement) => requirement.id === "value")
				?.runtimeOnly,
		).toBe(true);
	});

	it("does not flatten captures inside a nested Macro", async () => {
		const buried = {
			...createCaptureChoice("Projects"),
			id: "buried-cap",
			name: "Buried",
		};
		const nestedMacro: IMacroChoice = {
			id: "inner-macro",
			name: "Inner macro",
			type: "Macro",
			command: false,
			runOnStartup: false,
			macro: {
				id: "inner-macro",
				name: "Inner macro",
				commands: [nestedChoice(buried)],
			},
		};

		const requirements = await collectChoiceRequirements(
			app,
			pluginWithChoices() as any,
			choiceExecutor,
			createMacroChoice(nestedChoice(nestedMacro)),
		);
		expect(requirements.some((requirement) => requirement.id === captureTargetKeyFor("buried-cap"))).toBe(
			false,
		);
	});

	it("does not collect Conditional then-branch captures", async () => {
		const thenCapture = {
			...createCaptureChoice("Projects"),
			id: "then-cap",
			name: "Then capture",
		};
		const macro = createMacroChoice(
			conditionalCommand("cond", "If project", [nestedChoice(thenCapture)]),
		);

		const requirements = await collectChoiceRequirements(
			app,
			pluginWithChoices() as any,
			choiceExecutor,
			macro,
		);

		expect(requirements).toEqual([]);
		expect(requirements.some((requirement) => requirement.id === captureTargetKeyFor("then-cap"))).toBe(
			false,
		);
	});

	it("excludes a nested Capture with onePageInput never", async () => {
		const optedOut = {
			...createCaptureChoice("Projects"),
			id: "never-cap",
			onePageInput: "never" as const,
			name: "Private capture",
		};
		const kept = {
			...createCaptureChoice("Inbox"),
			id: "kept-cap",
			name: "Public capture",
		};
		const macro = createMacroChoice(nestedChoice(optedOut), nestedChoice(kept));

		const requirements = await collectChoiceRequirements(
			app,
			pluginWithChoices() as any,
			choiceExecutor,
			macro,
		);

		expect(requirements.map((requirement) => requirement.id)).toEqual([
			captureTargetKeyFor("kept-cap"),
		]);
		expect(requirements.some((requirement) => requirement.id === captureTargetKeyFor("never-cap"))).toBe(
			false,
		);
	});

	it("collects the first capture plus script inputs and defers a later capture after UserScript", async () => {
		getUserScriptMock.mockResolvedValue({
			quickadd: {
				inputs: [{ id: "scriptField", type: "text", label: "Script" }],
			},
		});
		const first = {
			...createCaptureChoice("Projects"),
			id: "cap-1",
			name: "First capture",
		};
		const second = {
			...createCaptureChoice("Inbox"),
			id: "cap-2",
			name: "Second capture",
		};
		const script: IUserScript = {
			id: "script-1",
			name: "Script 1",
			type: CommandType.UserScript,
			path: "script.js",
			settings: {},
		};
		const macro = createMacroChoice(
			nestedChoice(first),
			script,
			nestedChoice(second),
		);

		const requirements = await collectChoiceRequirements(
			app,
			pluginWithChoices() as any,
			choiceExecutor,
			macro,
		);

		expect(requirements.map((requirement) => requirement.id)).toEqual([
			captureTargetKeyFor("cap-1"),
			"scriptField",
		]);
		expect(requirements.some((requirement) => requirement.id === captureTargetKeyFor("cap-2"))).toBe(
			false,
		);
	});

	it("hoists inputs from two UserScripts even when the first is opaque", async () => {
		getUserScriptMock.mockImplementation(async (command: IUserScript) => {
			if (command.path === "a.js") {
				return {
					quickadd: { inputs: [{ id: "fromA", type: "text", label: "A" }] },
				};
			}
			return {
				quickadd: { inputs: [{ id: "fromB", type: "text", label: "B" }] },
			};
		});
		const first: IUserScript = {
			id: "s1",
			name: "Script A",
			type: CommandType.UserScript,
			path: "a.js",
			settings: {},
		};
		const second: IUserScript = {
			id: "s2",
			name: "Script B",
			type: CommandType.UserScript,
			path: "b.js",
			settings: {},
		};

		const requirements = await collectChoiceRequirements(
			app,
			pluginWithChoices() as any,
			choiceExecutor,
			createMacroChoice(first, second),
		);

		expect(requirements.map((requirement) => requirement.id)).toEqual([
			"fromA",
			"fromB",
		]);
	});

	it.each([
		{
			name: "nested Macro",
			cut: nestedChoice({
				id: "inner-macro",
				name: "Inner macro",
				type: "Macro",
				command: false,
				runOnStartup: false,
				macro: { id: "inner-macro", name: "Inner macro", commands: [] },
			} as IMacroChoice),
		},
		{
			name: "Multi",
			cut: nestedChoice({
				id: "inner-multi",
				name: "Inner multi",
				type: "Multi",
				command: false,
			}),
		},
		{
			name: "Conditional",
			cut: conditionalCommand("cond", "If project", []),
		},
	])(
		"keeps the first capture's target and drops a later capture after a $name",
		async ({ cut }) => {
			const first = {
				...createCaptureChoice("Projects"),
				id: "first-cap",
				name: "First capture",
			};
			const later = {
				...createCaptureChoice("Inbox"),
				id: "later-cap",
				name: "Later capture",
			};

			const requirements = await collectChoiceRequirements(
				app,
				pluginWithChoices() as any,
				choiceExecutor,
				createMacroChoice(nestedChoice(first), cut, nestedChoice(later)),
			);
			const ids = requirements.map((requirement) => requirement.id);

			expect(ids).toContain(captureTargetKeyFor("first-cap"));
			expect(ids).not.toContain(captureTargetKeyFor("later-cap"));
		},
	);

	it("collects a Choice command Capture when getChoiceById resolves it", async () => {
		const capture = {
			...createCaptureChoice("Projects"),
			id: "cap-ref",
			name: "Referenced capture",
		};

		const requirements = await collectChoiceRequirements(
			app,
			pluginWithChoices({ [capture.id]: capture }) as any,
			choiceExecutor,
			createMacroChoice(choiceCommand("choice-cmd", "Run capture", capture.id)),
		);

		expect(requirements.map((requirement) => requirement.id)).toEqual([
			captureTargetKeyFor("cap-ref"),
		]);
	});

	it("defers a dangling Choice command without throwing", async () => {
		const plugin = pluginWithChoices();
		const macro = createMacroChoice(
			choiceCommand("choice-cmd", "Missing capture", "missing-id"),
		);

		await expect(
			collectChoiceRequirements(app, plugin as any, choiceExecutor, macro),
		).resolves.toEqual([]);
	});
});

describe("property capture requirements", () => {
	it.each(["number", "checkbox"])("uses a known property's %s widget in the one-page form", async (type) => {
		const choice = createCaptureChoice("Inbox.md");
		choice.propertyCapture = { property: { kind: "named", format: "rating" }, action: "set", createIfMissing: true };
		choice.format = { enabled: true, format: "{{VALUE:ratingInput}}" };
		const requirements = await collectChoiceRequirements({
			vault: { getAbstractFileByPath: () => null },
			metadataTypeManager: { getAllProperties: () => ({ rating: {} }), getTypeInfo: () => ({ expected: { type } }) },
		} as unknown as App, createPreflightPlugin(false), createChoiceExecutor(), choice);
		expect(requirements).toEqual([expect.objectContaining({ id: "ratingInput", type: type === "checkbox" ? "dropdown" : type })]);
		expect(requirements[0].runtimeOnly).not.toBe(true);
	});

	it("defers only the value whose native property type depends on the runtime selection", async () => {
		const choice = createCaptureChoice("Inbox.md");
		choice.propertyCapture = { property: { kind: "named", format: "{{VALUE:propertyName}}" }, action: "set", createIfMissing: true };
		choice.format = { enabled: true, format: "{{VALUE:propertyInput}}" };
		const requirements = await collectChoiceRequirements({ vault: { getAbstractFileByPath: () => null } } as unknown as App,
			createPreflightPlugin(false), createChoiceExecutor(), choice);
		expect(requirements.find((requirement) => requirement.id === "propertyInput")?.runtimeOnly).toBe(true);
		expect(requirements.find((requirement) => requirement.id === "propertyName")?.runtimeOnly).not.toBe(true);
	});

	it("collects property-name and value formats while ignoring dormant body-position fields", async () => {
		const choice = createCaptureChoice("Inbox.md");
		choice.propertyCapture = { property: { kind: "named", format: "{{VALUE:property}}" }, action: "set", createIfMissing: true };
		choice.format = { enabled: true, format: "{{VALUE:amount|type:number}}" };
		choice.insertAfter.enabled = true;
		choice.insertAfter.after = "{{VALUE:dormantAfter}}";
		choice.insertBefore = { enabled: true, before: "{{VALUE:dormantBefore}}", createIfNotFound: false, createIfNotFoundLocation: "top" };
		const requirements = await collectChoiceRequirements({ vault: { getAbstractFileByPath: () => null }, workspace: { getActiveViewOfType: () => null } } as unknown as App,
			createPreflightPlugin(false),
			createChoiceExecutor(), choice);
		expect(requirements.map((requirement) => requirement.id)).toEqual(["property", "amount"]);
		expect(requirements.find((requirement) => requirement.id === "amount")?.type).toBe("number");
		expect(requirements.every((requirement) => requirement.pathContext)).toBe(true);
	});
});
