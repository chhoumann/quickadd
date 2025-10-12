import { Buffer } from "buffer";
import { describe, expect, it, beforeEach, vi } from "vitest";
import type { App } from "obsidian";
import { CommandType } from "../../src/types/macros/CommandType";
import type IChoice from "../../src/types/choices/IChoice";
import type IMacroChoice from "../../src/types/choices/IMacroChoice";
import type { IChoiceCommand } from "../../src/types/macros/IChoiceCommand";
import type { ICommand } from "../../src/types/macros/ICommand";
import { TemplateChoice } from "../../src/types/choices/TemplateChoice";
import type ITemplateChoice from "../../src/types/choices/ITemplateChoice";
import { CaptureChoice } from "../../src/types/choices/CaptureChoice";
import type ICaptureChoice from "../../src/types/choices/ICaptureChoice";
import { MultiChoice } from "../../src/types/choices/MultiChoice";
import type { IUserScript } from "../../src/types/macros/IUserScript";
import type { IConditionalCommand } from "../../src/types/macros/Conditional/IConditionalCommand";
import {
	QUICKADD_PACKAGE_SCHEMA_VERSION,
	type QuickAddPackage,
} from "../../src/types/packages/QuickAddPackage";
import {
	applyPackageImport,
	analysePackage,
	readQuickAddPackage,
} from "../../src/services/packageImportService";

function createMockApp(initialFiles: Record<string, string> = {}): App {
	const files = new Map(Object.entries(initialFiles));

	const exists = vi.fn(async (path: string) => files.has(path));
	const read = vi.fn(async (path: string) => {
		const content = files.get(path);
		if (content === undefined) throw new Error(`Missing file: ${path}`);
		return content;
	});
	const write = vi.fn(async (path: string, content: string) => {
		files.set(path, content);
	});
	const createFolder = vi.fn(async (path: string) => {
		files.set(path, "");
	});

	return {
		vault: {
			adapter: {
				exists,
				read,
				write,
			},
			createFolder,
		},
	} as unknown as App;
}

function makeMacroChoice(
	options: {
		id?: string;
		name?: string;
		commands?: ICommand[];
	} = {},
): IMacroChoice {
	const id = options.id ?? "macro-1";
	const name = options.name ?? "Macro One";
	const commands = options.commands ?? [];

	return {
		id,
		name,
		type: "Macro",
		command: false,
		runOnStartup: false,
		onePageInput: undefined,
		macro: {
			id,
			name,
			commands: commands.map((command) => ({ ...command })),
		},
	};
}

describe("packageImportService", () => {
	beforeEach(() => {
		vi.restoreAllMocks();
	});

	it("readQuickAddPackage validates schema", async () => {
	const pkg: QuickAddPackage = {
		schemaVersion: QUICKADD_PACKAGE_SCHEMA_VERSION,
		quickAddVersion: "2.5.0",
		createdAt: new Date().toISOString(),
		rootChoiceIds: ["macro-1"],
		choices: [
			{
				choice: makeMacroChoice(),
				pathHint: ["Macro One"],
				parentChoiceId: null,
			},
		],
		assets: [],
	};

		const mockApp = createMockApp({
			"packages/sample.quickadd.json": JSON.stringify(pkg),
		});

		const result = await readQuickAddPackage(
			mockApp,
			"packages/sample.quickadd.json",
		);

		expect(result.pkg.rootChoiceIds).toEqual(["macro-1"]);
	});

	it("analysePackage detects existing choice conflicts", async () => {
	const existing: IChoice[] = [makeMacroChoice({ id: "macro-1" })];
	const pkg: QuickAddPackage = {
		schemaVersion: QUICKADD_PACKAGE_SCHEMA_VERSION,
		quickAddVersion: "2.5.0",
		createdAt: new Date().toISOString(),
		rootChoiceIds: ["macro-1"],
		choices: [
			{
				choice: makeMacroChoice({ id: "macro-1" }),
				pathHint: ["Macro One"],
				parentChoiceId: null,
			},
		],
		assets: [],
	};

		const mockApp = createMockApp();
		const analysis = await analysePackage(mockApp, existing, pkg);
		expect(analysis.choiceConflicts[0]?.exists).toBe(true);
	});

	it("applyPackageImport overwrites existing choice when requested", async () => {
	const existingMacro = makeMacroChoice({
		id: "macro-1",
		name: "Macro One",
		commands: [],
	});

	const waitCommand: ICommand = {
		id: "cmd-1",
		name: "Wait",
		type: CommandType.Wait,
	};

	const updatedMacro = makeMacroChoice({
		id: "macro-1",
		name: "Macro One",
		commands: [waitCommand],
	});

	const pkg: QuickAddPackage = {
		schemaVersion: QUICKADD_PACKAGE_SCHEMA_VERSION,
		quickAddVersion: "2.5.0",
		createdAt: new Date().toISOString(),
		rootChoiceIds: ["macro-1"],
		choices: [
			{
				choice: updatedMacro,
				pathHint: ["Macro One"],
				parentChoiceId: null,
			},
		],
		assets: [],
	};

	const mockApp = createMockApp();
	const result = await applyPackageImport({
		app: mockApp,
		existingChoices: [existingMacro],
		pkg,
		choiceDecisions: [{ choiceId: "macro-1", mode: "overwrite" }],
		assetDecisions: [],
	});

		expect(result.overwrittenChoiceIds).toContain("macro-1");
		expect(result.updatedChoices[0]).toEqual(updatedMacro);
	});

	it("applyPackageImport duplicates choices with remapped ids", async () => {
	const existing: IChoice[] = [makeMacroChoice({ id: "macro-1" })];

	const childMacro: IMacroChoice = makeMacroChoice({
		id: "macro-2",
		name: "Child",
	});
	const choiceCommand: IChoiceCommand = {
		id: "choice-cmd",
		name: "Run Child",
		type: CommandType.Choice,
		choiceId: "macro-2",
	};
	const parentMacro: IMacroChoice = makeMacroChoice({
		id: "macro-root",
		name: "Parent",
		commands: [choiceCommand],
	});

	const pkg: QuickAddPackage = {
		schemaVersion: QUICKADD_PACKAGE_SCHEMA_VERSION,
		quickAddVersion: "2.5.0",
		createdAt: new Date().toISOString(),
		rootChoiceIds: ["macro-root"],
		choices: [
			{
				choice: parentMacro,
				pathHint: ["Parent"],
				parentChoiceId: null,
			},
			{
				choice: childMacro,
				pathHint: ["Parent", "Child"],
				parentChoiceId: "macro-root",
			},
		],
		assets: [],
	};

	const mockApp = createMockApp();
	const result = await applyPackageImport({
		app: mockApp,
		existingChoices: existing,
		pkg,
		choiceDecisions: [
			{ choiceId: "macro-root", mode: "duplicate" },
			{ choiceId: "macro-2", mode: "duplicate" },
		],
		assetDecisions: [],
	});

		expect(result.addedChoiceIds.length).toBeGreaterThanOrEqual(1);
		const imported = result.updatedChoices.find(
			(choice) => choice.name === "Parent" && choice.id !== "macro-root",
		) as IMacroChoice | undefined;
		expect(imported).toBeTruthy();
		const command = imported?.macro.commands[0];
		expect(command?.type).toBe(CommandType.Choice);
		expect((command as any)?.choiceId).not.toBe("macro-2");
	});

	it("applyPackageImport rewrites template paths when destination changes", async () => {
		const templateChoice = new TemplateChoice("Journal Template");
		templateChoice.templatePath = "Templates/original.md";

		const pkg: QuickAddPackage = {
			schemaVersion: QUICKADD_PACKAGE_SCHEMA_VERSION,
			quickAddVersion: "2.5.0",
			createdAt: new Date().toISOString(),
			rootChoiceIds: [templateChoice.id],
			choices: [
				{
					choice: templateChoice,
					pathHint: ["Journal Template"],
					parentChoiceId: null,
				},
			],
			assets: [
				{
					kind: "template",
					originalPath: "Templates/original.md",
					contentEncoding: "base64",
					content: Buffer.from("Template content").toString("base64"),
				},
			],
		};

		const mockApp = createMockApp();
		const result = await applyPackageImport({
			app: mockApp,
			existingChoices: [],
			pkg,
			choiceDecisions: [
				{ choiceId: templateChoice.id, mode: "import" },
			],
			assetDecisions: [
				{
					originalPath: "Templates/original.md",
					destinationPath: "Templates/new.md",
					mode: "write",
				},
			],
		});

		const importedChoice = result.updatedChoices.find(
			(choice) => choice.id === templateChoice.id,
		) as ITemplateChoice | undefined;
		expect(importedChoice?.templatePath).toBe("Templates/new.md");
		expect(result.writtenAssets).toContain("Templates/new.md");
	});

	it("applyPackageImport rewrites capture template paths when destination changes", async () => {
		const captureChoice = new CaptureChoice("Daily Capture");
		captureChoice.createFileIfItDoesntExist.enabled = true;
		captureChoice.createFileIfItDoesntExist.createWithTemplate = true;
		captureChoice.createFileIfItDoesntExist.template = "Templates/capture-original.md";

		const pkg: QuickAddPackage = {
			schemaVersion: QUICKADD_PACKAGE_SCHEMA_VERSION,
			quickAddVersion: "2.5.0",
			createdAt: new Date().toISOString(),
			rootChoiceIds: [captureChoice.id],
			choices: [
				{
					choice: captureChoice,
					pathHint: ["Daily Capture"],
					parentChoiceId: null,
				},
			],
			assets: [
				{
					kind: "capture-template",
					originalPath: "Templates/capture-original.md",
					contentEncoding: "base64",
					content: Buffer.from("Capture template").toString("base64"),
				},
			],
		};

		const mockApp = createMockApp();
		const result = await applyPackageImport({
			app: mockApp,
			existingChoices: [],
			pkg,
			choiceDecisions: [
				{ choiceId: captureChoice.id, mode: "import" },
			],
			assetDecisions: [
				{
					originalPath: "Templates/capture-original.md",
					destinationPath: "Templates/capture-new.md",
					mode: "write",
				},
			],
		});

		const importedCapture = result.updatedChoices.find(
			(choice) => choice.id === captureChoice.id,
		) as ICaptureChoice | undefined;
		expect(importedCapture?.createFileIfItDoesntExist?.template).toBe(
			"Templates/capture-new.md",
		);
		expect(result.writtenAssets).toContain("Templates/capture-new.md");
	});

	it("skips descendants marked as skip when importing multi choices", async () => {
		const templateA = new TemplateChoice("Template A");
		templateA.templatePath = "Templates/A.md";
		const templateB = new TemplateChoice("Template B");
		templateB.templatePath = "Templates/B.md";

		const group = new MultiChoice("Group");
		group.choices.push(templateA, templateB);

		const pkg: QuickAddPackage = {
			schemaVersion: QUICKADD_PACKAGE_SCHEMA_VERSION,
			quickAddVersion: "2.5.0",
			createdAt: new Date().toISOString(),
			rootChoiceIds: [group.id],
			choices: [
				{
					choice: group,
					pathHint: ["Group"],
					parentChoiceId: null,
				},
				{
					choice: templateA,
					pathHint: ["Group", "Template A"],
					parentChoiceId: group.id,
				},
				{
					choice: templateB,
					pathHint: ["Group", "Template B"],
					parentChoiceId: group.id,
				},
			],
			assets: [],
		};

		const mockApp = createMockApp();
		const result = await applyPackageImport({
			app: mockApp,
			existingChoices: [],
			pkg,
			choiceDecisions: [
				{ choiceId: group.id, mode: "import" },
				{ choiceId: templateA.id, mode: "import" },
				{ choiceId: templateB.id, mode: "skip" },
			],
			assetDecisions: [],
		});

		const importedGroup = result.updatedChoices.find(
			(choice) => choice.id === group.id,
		) as MultiChoice | undefined;
		expect(importedGroup).toBeTruthy();
		expect(importedGroup?.choices?.map((c) => c.id)).toEqual([templateA.id]);
	});

	it("applyPackageImport rewrites user script command paths when destination changes", async () => {
		const userScriptCommand: IUserScript = {
			id: "cmd-user-script",
			name: "Run Script",
			type: CommandType.UserScript,
			path: "Scripts/original.js",
			settings: {},
		};

		const macroChoice = makeMacroChoice({
			id: "macro-user-script",
			name: "Macro with script",
			commands: [userScriptCommand],
		});

		const pkg: QuickAddPackage = {
			schemaVersion: QUICKADD_PACKAGE_SCHEMA_VERSION,
			quickAddVersion: "2.5.0",
			createdAt: new Date().toISOString(),
			rootChoiceIds: [macroChoice.id],
			choices: [
				{
					choice: macroChoice,
					pathHint: ["Macro with script"],
					parentChoiceId: null,
				},
			],
			assets: [
				{
					kind: "user-script",
					originalPath: "Scripts/original.js",
					contentEncoding: "base64",
					content: Buffer.from("console.log('hello');").toString("base64"),
				},
			],
		};

		const mockApp = createMockApp();
		const result = await applyPackageImport({
			app: mockApp,
			existingChoices: [],
			pkg,
			choiceDecisions: [
				{ choiceId: macroChoice.id, mode: "import" },
			],
			assetDecisions: [
				{
					originalPath: "Scripts/original.js",
					destinationPath: "Scripts/custom.js",
					mode: "write",
				},
			],
		});

		const importedMacro = result.updatedChoices.find(
			(choice) => choice.id === macroChoice.id,
		) as IMacroChoice | undefined;
		const importedCommand = importedMacro?.macro.commands[0] as IUserScript | undefined;
		expect(importedCommand?.path).toBe("Scripts/custom.js");
		expect(result.writtenAssets).toContain("Scripts/custom.js");
	});

	it("applyPackageImport rewrites conditional script paths when destination changes", async () => {
		const conditionalCommand: IConditionalCommand = {
			id: "cmd-conditional",
			name: "Check Script",
			type: CommandType.Conditional,
			condition: {
				mode: "script",
				scriptPath: "Scripts/check-original.js",
			},
			thenCommands: [],
			elseCommands: [],
		};

		const macroChoice = makeMacroChoice({
			id: "macro-conditional",
			name: "Macro with conditional",
			commands: [conditionalCommand],
		});

		const pkg: QuickAddPackage = {
			schemaVersion: QUICKADD_PACKAGE_SCHEMA_VERSION,
			quickAddVersion: "2.5.0",
			createdAt: new Date().toISOString(),
			rootChoiceIds: [macroChoice.id],
			choices: [
				{
					choice: macroChoice,
					pathHint: ["Macro with conditional"],
					parentChoiceId: null,
				},
			],
			assets: [
				{
					kind: "conditional-script",
					originalPath: "Scripts/check-original.js",
					contentEncoding: "base64",
					content: Buffer.from("module.exports = () => true;").toString("base64"),
				},
			],
		};

		const mockApp = createMockApp();
		const result = await applyPackageImport({
			app: mockApp,
			existingChoices: [],
			pkg,
			choiceDecisions: [
				{ choiceId: macroChoice.id, mode: "import" },
			],
			assetDecisions: [
				{
					originalPath: "Scripts/check-original.js",
					destinationPath: "Scripts/check-custom.js",
					mode: "write",
				},
			],
		});

		const importedMacro = result.updatedChoices.find(
			(choice) => choice.id === macroChoice.id,
		) as IMacroChoice | undefined;
		const importedConditional = importedMacro?.macro.commands[0] as IConditionalCommand | undefined;
		expect(
			importedConditional?.condition.mode === "script" &&
				importedConditional.condition.scriptPath,
		).toBe("Scripts/check-custom.js");
		expect(result.writtenAssets).toContain("Scripts/check-custom.js");
	});
});
