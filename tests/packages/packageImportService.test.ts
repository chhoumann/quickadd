import { describe, expect, it, beforeEach, vi } from "vitest";
import type { App } from "obsidian";
import { CommandType } from "../../src/types/macros/CommandType";
import type IChoice from "../../src/types/choices/IChoice";
import type IMacroChoice from "../../src/types/choices/IMacroChoice";
import type { IChoiceCommand } from "../../src/types/macros/IChoiceCommand";
import type { ICommand } from "../../src/types/macros/ICommand";
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
});
